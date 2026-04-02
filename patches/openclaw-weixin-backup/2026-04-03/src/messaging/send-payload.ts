import path from "node:path";

import { resolvePreferredOpenClawTmpDir } from "openclaw/plugin-sdk/infra-runtime";

import type { WeixinApiOptions } from "../api/api.js";
import { downloadRemoteImageToTemp } from "../cdn/upload.js";
import { logger } from "../util/logger.js";

import { sendWeixinMediaFile } from "./send-media.js";
import { sendMessageWeixin } from "./send.js";

const MEDIA_OUTBOUND_TEMP_DIR = path.join(resolvePreferredOpenClawTmpDir(), "weixin/media/outbound-temp");

type DeliverWeixinOutboundPayloadParams = {
  to: string;
  text: string;
  mediaUrl?: string;
  opts: WeixinApiOptions & { contextToken?: string };
  cdnBaseUrl: string;
};

export async function deliverWeixinOutboundPayload(
  params: DeliverWeixinOutboundPayloadParams,
): Promise<void> {
  const { to, text, mediaUrl, opts, cdnBaseUrl } = params;

  if (!mediaUrl) {
    logger.debug(`outbound: sending text message to=${to}`);
    await sendMessageWeixin({ to, text, opts });
    logger.info(`outbound: text sent OK to=${to}`);
    return;
  }

  let filePath: string;
  if (!mediaUrl.includes("://") || mediaUrl.startsWith("file://")) {
    if (mediaUrl.startsWith("file://")) {
      filePath = new URL(mediaUrl).pathname;
    } else if (!path.isAbsolute(mediaUrl)) {
      filePath = path.resolve(mediaUrl);
      logger.debug(`outbound: resolved relative path ${mediaUrl} -> ${filePath}`);
    } else {
      filePath = mediaUrl;
    }
    logger.debug(`outbound: local file path resolved filePath=${filePath}`);
  } else if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) {
    logger.debug(`outbound: downloading remote mediaUrl=${mediaUrl.slice(0, 80)}...`);
    filePath = await downloadRemoteImageToTemp(mediaUrl, MEDIA_OUTBOUND_TEMP_DIR);
    logger.debug(`outbound: remote image downloaded to filePath=${filePath}`);
  } else {
    logger.warn(
      `outbound: unrecognized mediaUrl scheme, sending text only mediaUrl=${mediaUrl.slice(0, 80)}`,
    );
    await sendMessageWeixin({ to, text, opts });
    logger.info(`outbound: text sent to=${to}`);
    return;
  }

  await sendWeixinMediaFile({
    filePath,
    to,
    text,
    opts,
    cdnBaseUrl,
  });
  logger.info(`outbound: media sent OK to=${to}`);
}

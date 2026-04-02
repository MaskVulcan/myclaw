import fs from "node:fs/promises";
import path from "node:path";
import { parseWeixinDirectSessionScope } from "../../agents/weixin-dm-scoped-memory.js";
import { normalizeChatType } from "../../channels/chat-type.js";
import { resolveCalendarScriptPath } from "../../cli/calendar-cli.js";
import { loadConfig, type OpenClawConfig } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";
import { createJob } from "../../cron/service/jobs.js";
import { createCronServiceState } from "../../cron/service/state.js";
import { loadCronStore, resolveCronStorePath, saveCronStore } from "../../cron/store.js";
import type { CronJob, CronJobCreate } from "../../cron/types.js";
import { execFileUtf8 } from "../../daemon/exec-file.js";
import { logVerbose } from "../../globals.js";
import type { FinalizedMsgContext } from "../templating.js";
import type { ReplyPayload } from "../types.js";

const WEIXIN_PROVIDER_ID = "openclaw-weixin";
const CALENDAR_OWNER_METADATA_BASENAME = ".openclaw-weixin-route.json";
const ANSI_ESCAPE_PREFIX = String.fromCharCode(0x1b);
const ANSI_ESCAPE_RE = new RegExp(`${ANSI_ESCAPE_PREFIX}\\[[0-9;]*[A-Za-z]`, "g");
const WHITESPACE_RE = /\s+/g;

const TIME_HINT_RE =
  /(?:今天|明天|后天|大后天|今晚|今早|今上午|今下午|下周|这周|本周|本星期|下星期|这星期|本月|这个月|下个月|周[一二三四五六日天]|星期[一二三四五六日天]|(?:未来|接下来|之后|后面|后续)[零一二两三四五六七八九十百〇\d]+\s*(?:天|日)|\d{4}[-/年]\d{1,2}(?:[-/月]\d{1,2}[日号]?)?|\d{1,2}月\d{1,2}[号日]?|\d{1,2}:\d{2}|\d{1,2}点半?|\d{1,2}时)/i;
const EVENT_VERB_RE =
  /(?:开会|会议|见面|约会|提醒|安排|review|meeting|call|拜访|汇报|讨论|沟通|对齐|面试|吃饭|聚餐|出差|体检|复诊|出发|提交|付款|交付)/i;
const SCHEDULE_NOUN_RE = /(?:日程|日历|安排|行程|会议|提醒|calendar|schedule|agenda|event|todo)/i;
const ADD_ACTION_RE =
  /(?:添加|新增|加个|加一下|安排|创建|记下|记个|记一下|帮我记|提醒我|设个提醒|设提醒|排个|排一下|放到日程)/i;
const SHOW_ACTION_RE =
  /(?:查看|看下|看看|查下|查询|列出|显示|发我|告诉我|给我|看一眼|过一下|show|list|view)/i;
const IMAGE_REQUEST_RE =
  /(?:发图|发图片|发个图|发张图|生成图|生成图片|日历图|日程图|安排图|render|image|png|截图|海报)/i;
const IMAGE_ONLY_RE =
  /(?:只(?:要|发)?(?:图|图片)|仅(?:图|图片)|不要(?:文字|文本)|别发(?:文字|文本)|无需(?:文字|文本))/i;
const TEXT_ONLY_RE =
  /(?:只(?:要|发)?(?:文字|文本)|仅(?:文字|文本)|纯(?:文字|文本)|不要(?:图|图片)|别发(?:图|图片)|无需(?:图|图片))/i;
const TEXT_PREFERENCE_RE =
  /(?:文字版|文本版|文字总结(?:版)?|文本总结(?:版)?|总结版|汇总版|纯文字|纯文本|文字回复|文本回复|发文字|发文本|按文字|按文本|总结一下|汇总一下)/i;
const QUESTION_RE = /[?？]|\b(?:吗|么)\b/;
const RANGE_RE =
  /(\d{1,2}(?:[./月]\d{1,2}[号日]?)?)\s*(?:-|~|～|到|至)\s*(\d{1,2}(?:[./月]\d{1,2}[号日]?)?)/i;
const FUTURE_DAYS_RE =
  /(?:未来|接下来|之后|后面|后续)([零一二两三四五六七八九十百〇\d]+)\s*(?:天|日)/i;
const EXPLICIT_NOTE_RE = /(?:备注|说明|补充|注意)[:：]\s*(.+)$/i;
const ATTACHMENT_CLAUSE_RE = /(?:附件|文件|材料)[:：]?\s*[^，。；;\n]+$/i;
const MEETING_CONTENT_LABEL_RE =
  /(?:会议内容|会议主题|会议议题|议题|主题|topic|agenda)[:：]\s*([^，。；;\n]{1,160})/i;
const MEETING_FILE_LABEL_RE =
  /(?:会议文件|会议资料|资料|附件|文件|材料)[:：]\s*([^，。；;\n]{1,160})/i;
const MEETING_LINK_LABEL_RE = /(?:会议链接|入会链接|加入链接|meeting link)[:：]?\s*/gi;
const LOCATION_LABEL_RE = /(?:地点|位置)[:：]\s*([^，。；;\n]{1,48})/i;
const LOCATION_AT_RE =
  /(?:在|于)\s*([^，。；;\n]{1,48}?)(?=(?:的|和|跟|与|同|开会|见面|约|沟通|讨论|review|meeting|call|提醒|安排|行程|附件|文件|备注|$))/i;
const LOCATION_INLINE_RE =
  /(?:线上|腾讯会议|飞书会议|Zoom|Teams|会议室[^，。；;\n]*|办公室[^，。；;\n]*|医院[^，。；;\n]*|机场[^，。；;\n]*|高铁站[^，。；;\n]*)/i;
const LOCATION_TRAILING_RE =
  /([^，。；;\n]{1,32}?(?:腾讯会议|飞书会议|Zoom|Teams|会议室|办公室|医院|机场|火车站|高铁站|车站|地铁站|码头|酒店|咖啡馆|餐厅))(?:的|(?=[，。；;\s]|$))/i;
const PARTICIPANT_MENTION_RE = /@([^\s@，。；;:]{1,24})/g;
const PARTICIPANT_WITH_RE =
  /(?:和|跟|与|同|约|叫上|叫|邀|请)\s*([^，。；;\n]{1,32}?)(?=(?:一起|开会|见面|约|沟通|讨论|review|meeting|call|吃饭|聚餐|拜访|汇报|对齐|聊|碰|面试|提醒|安排|日程|行程|在|于|$))/gi;
const PERSON_SPLIT_RE = /[、,，/]|和|及|与|跟/;
const ADD_PREFIX_RE =
  /^(?:请|帮我|麻烦|辛苦|给我|替我|直接)?\s*(?:添加|新增|加个|加一下|安排|创建|记下|记个|记一下|帮我记|提醒我|设个提醒|设提醒|排个|排一下|放到日程)(?:一个|个|条)?(?:日程|提醒|行程|安排|会议|会|事件)?(?:吧|下)?[:：,，\s]*/i;
const SHOW_PREFIX_RE =
  /^(?:请|帮我|麻烦|给我|替我|直接)?\s*(?:查看|看下|看看|查下|查询|列出|显示|发我|告诉我|给我|看一眼|过一下)(?:一下)?(?:日程|日历|安排|行程|会议|提醒)?(?:吧|下)?[:：,，\s]*/i;
const RENDER_PREFIX_RE =
  /^(?:请|帮我|麻烦|给我|替我|直接)?\s*(?:发图|发图片|发个图|发张图|生成图|生成图片|日历图|日程图|安排图|render|image)(?:给我)?(?:吧|下)?[:：,，\s]*/i;
const GENERIC_PERSON_RE =
  /^(?:我|我们|自己|一下|一个|大家|同学们|朋友们|同事们|客户们|老师们|家里|公司)$/i;
const NON_PERSON_PARTICIPANT_RE =
  /(?:日历|图片|图|文字|文本|总结|汇总|总结版|汇总版|安排|日程|行程|会议|提醒|未来|今天|明天|后天|行李(?:箱)?|箱子|背包|书包|电脑包|公文包|文件|资料|材料|附件|合同|简历|方案|清单|证件|身份证|护照|港澳通行证|通行证|车票|机票|门票|钥匙|药|充电器|电源|衣服|外套|雨伞|钱包|银行卡)/i;
const CALENDAR_EVENT_ID_LINE_RE = /^\s*(?:🔖\s*)?ID[:：]\s*evt_[A-Za-z0-9_-]+\s*(?:\n|$)/gim;
const URL_RE = /\bhttps?:\/\/[^\s，。；;]+/gi;
const FILE_NAME_RE =
  /[A-Za-z0-9_\u4e00-\u9fa5\-./]+?\.(?:pdf|docx?|xlsx|pptx|csv|txt|md|jpg|jpeg|png|zip|rar)/gi;
const CRON_REMINDER_WRAPPER_RE =
  /^A scheduled reminder has been triggered\. The reminder content is:\s*([\s\S]*?)\s*(?:Please relay this reminder to the user in a helpful and friendly way\.|Handle this reminder internally\. Do not relay it to the user unless explicitly requested\.)\s*$/i;
const CRON_REMINDER_PREFIX_RE =
  /A scheduled reminder has been triggered\. The reminder content is:\s*/i;
const CRON_REMINDER_SUFFIXES = [
  "Please relay this reminder to the user in a helpful and friendly way.",
  "Handle this reminder internally. Do not relay it to the user unless explicitly requested.",
] as const;
const CURRENT_TIME_LINE_RE = /\n?Current time:[^\n]*(?:\n|$)/gi;
const REMINDER_JOB_NAME_PREFIX = "openclaw:smart-calendar:weixin-digest";
const REMINDER_DESCRIPTION = "Auto-generated Weixin smart-calendar daily digest";
const REMINDER_TIMEZONE = "Asia/Shanghai";
const DATE_YEAR_RE = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})[日号]?/;
const DATE_MONTH_DAY_RE = /(\d{1,2})[./月](\d{1,2})[日号]?/;
const DATE_WEEKDAY_RE = /(?:(这|本|下|上)?(?:周|星期))([一二三四五六日天])/i;
const TIME_RANGE_VALUE_RE = /(\d{1,2}:\d{2})\s*[-–~到]\s*(\d{1,2}:\d{2})/i;
const TIME_COLON_RE =
  /(?:(凌晨|早上|上午|中午|下午|傍晚|晚上|今晚|明晚|今早|明早|今上午|明上午|今下午|明下午)\s*)?(\d{1,2})[:：](\d{2})/i;
const TIME_TEXT_RE =
  /(?:(凌晨|早上|上午|中午|下午|傍晚|晚上|今晚|明晚|今早|明早|今上午|明上午|今下午|明下午)\s*)?([零〇一二两三四五六七八九十百\d]{1,4})\s*(?:点|时)(半|一刻|三刻|[零〇一二两三四五六七八九十百\d]{1,4}(?:分)?)?/i;
const TITLE_STRIP_PATTERNS = [
  /\d{4}[-/年]\d{1,2}(?:[-/月]\d{1,2}[日号]?)?/g,
  /\d{1,2}月\d{1,2}[号日]?/g,
  /(?:今天|明天|后天|大后天|今晚|今早|今上午|今下午|下周|这周|本周|本月|这个月|下个月|周[一二三四五六日天]|星期[一二三四五六日天])/g,
  /(?:上午|下午|晚上|中午|早上|凌晨)/g,
  /\d{1,2}:\d{2}(?:\s*[-–~到]\s*\d{1,2}:\d{2})?/g,
  /\d{1,2}点半?/g,
  /\d{1,2}时/g,
  /(?:凌晨|早上|上午|中午|下午|傍晚|晚上|今晚|明晚|今早|明早|今上午|明上午|今下午|明下午)?[零〇一二两三四五六七八九十百\d]+点(?:半|一刻|三刻|[零〇一二两三四五六七八九十百\d]+分?)?/g,
];

type CalendarFastpassIntent = "add" | "show" | "render";
type LookupResponseMode = "text" | "image" | "both";
type CalendarLookupWindow =
  | { kind: "range"; range: string; days?: number }
  | { kind: "month" }
  | { kind: "week" }
  | { kind: "date"; dateText: string }
  | { kind: "default" };

type CalendarCliDeps = {
  execFile?: typeof execFileUtf8;
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
  calendarScriptPath?: string;
  cronStorePath?: string;
  nowMs?: () => number;
  dispatchGateway?: <T>(method: string, params: Record<string, unknown>) => Promise<T>;
};

export type BundledSkillFastpassResult = {
  handled: boolean;
  payload?: ReplyPayload;
  reason?: string;
};

let gatewayInternalDispatchRuntimePromise: Promise<
  typeof import("../../gateway/server-plugins.js")
> | null = null;

function loadGatewayInternalDispatchRuntime() {
  gatewayInternalDispatchRuntimePromise ??= import("../../gateway/server-plugins.js");
  return gatewayInternalDispatchRuntimePromise;
}

function collapseWhitespace(value: string | undefined): string {
  return (value ?? "").replace(/\r\n/g, "\n").replace(WHITESPACE_RE, " ").trim();
}

function sanitizeCliText(value: string | undefined): string {
  return (value ?? "").replace(/\r\n/g, "\n").replace(ANSI_ESCAPE_RE, "").trim();
}

function stripCalendarEventIdLines(value: string): string {
  return value
    .replace(CALENDAR_EVENT_ID_LINE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractUserVisibleCliText(value: string | undefined): string {
  const text = sanitizeCliText(value);
  if (!text) {
    return "";
  }
  const match = text.match(/(?:^|\n)(?:🎨|✅|📅|⚠️|❌)/m);
  if (!match || typeof match.index !== "number") {
    return text;
  }
  const startsWithNewline = match[0].startsWith("\n");
  const startIndex = match.index + (startsWithNewline ? 1 : 0);
  return stripCalendarEventIdLines(text.slice(startIndex).trim());
}

function resolveWeixinProviderId(
  ctx: Pick<FinalizedMsgContext, "OriginatingChannel" | "Surface" | "Provider">,
): string | undefined {
  const candidates = [ctx.OriginatingChannel, ctx.Surface, ctx.Provider] as const;
  for (const candidate of candidates) {
    const normalized = candidate?.trim().toLowerCase();
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function isWeixinDirectContext(
  ctx: Pick<FinalizedMsgContext, "ChatType" | "OriginatingChannel" | "Surface" | "Provider">,
): boolean {
  if (resolveWeixinProviderId(ctx) !== WEIXIN_PROVIDER_ID) {
    return false;
  }
  const chatType = normalizeChatType(ctx.ChatType);
  return !chatType || chatType === "direct";
}

function encodePathSegment(value: string | undefined): string {
  const trimmed = value?.trim();
  return encodeURIComponent(trimmed || "unknown");
}

export function resolveWeixinCalendarHome(params: {
  ctx: Pick<
    FinalizedMsgContext,
    | "SessionKey"
    | "AccountId"
    | "OriginatingTo"
    | "SenderId"
    | "From"
    | "ChatType"
    | "OriginatingChannel"
    | "Surface"
    | "Provider"
  >;
  env?: NodeJS.ProcessEnv;
  stateDir?: string;
}): string | undefined {
  if (!isWeixinDirectContext(params.ctx)) {
    return undefined;
  }

  const stateDir = params.stateDir ?? resolveStateDir(params.env ?? process.env);
  const scoped = parseWeixinDirectSessionScope(params.ctx.SessionKey);
  const accountId = scoped?.accountId ?? params.ctx.AccountId?.trim() ?? "default";
  const peerId =
    scoped?.peerId ??
    params.ctx.OriginatingTo?.trim() ??
    params.ctx.SenderId?.trim() ??
    params.ctx.From?.trim();
  if (!peerId) {
    return undefined;
  }

  return path.join(
    stateDir,
    "skills-data",
    "smart-calendar",
    "weixin-dm",
    encodePathSegment(accountId),
    encodePathSegment(peerId.toLowerCase()),
  );
}

function resolveSourceText(
  ctx: Pick<FinalizedMsgContext, "BodyForCommands" | "CommandBody" | "RawBody" | "Body">,
): string {
  const raw =
    [ctx.BodyForCommands, ctx.CommandBody, ctx.RawBody, ctx.Body].find(
      (value) => typeof value === "string" && value.trim().length > 0,
    ) ?? "";
  const unwrapped = unwrapCronReminderText(raw);
  return collapseWhitespace(unwrapped || raw);
}

function unwrapCronReminderText(raw: string): string | undefined {
  const directMatch = raw.match(CRON_REMINDER_WRAPPER_RE)?.[1]?.trim();
  if (directMatch) {
    return directMatch;
  }

  const prefixMatch = CRON_REMINDER_PREFIX_RE.exec(raw);
  if (!prefixMatch || typeof prefixMatch.index !== "number") {
    return undefined;
  }

  let remainder = raw.slice(prefixMatch.index + prefixMatch[0].length);
  const suffixIndexes = CRON_REMINDER_SUFFIXES.map((suffix) => remainder.indexOf(suffix)).filter(
    (index) => index >= 0,
  );
  if (suffixIndexes.length > 0) {
    remainder = remainder.slice(0, Math.min(...suffixIndexes));
  }

  remainder = remainder.replace(CURRENT_TIME_LINE_RE, "").trim();
  return remainder || undefined;
}

function resolveCalendarIntent(text: string): CalendarFastpassIntent | null {
  const normalized = collapseWhitespace(text);
  if (!normalized || normalized.startsWith("/")) {
    return null;
  }
  if (ADD_ACTION_RE.test(normalized)) {
    return "add";
  }
  if (
    TIME_HINT_RE.test(normalized) &&
    EVENT_VERB_RE.test(normalized) &&
    !QUESTION_RE.test(normalized)
  ) {
    return "add";
  }
  const hasScheduleContext = SCHEDULE_NOUN_RE.test(normalized) || TIME_HINT_RE.test(normalized);
  if (
    hasScheduleContext &&
    IMAGE_REQUEST_RE.test(normalized) &&
    resolveLookupResponseMode(normalized) === "image"
  ) {
    return "render";
  }
  if (
    (SHOW_ACTION_RE.test(normalized) && hasScheduleContext) ||
    (SCHEDULE_NOUN_RE.test(normalized) &&
      (TIME_HINT_RE.test(normalized) ||
        QUESTION_RE.test(normalized) ||
        IMAGE_REQUEST_RE.test(normalized)))
  ) {
    return "show";
  }
  return null;
}

function stripIntentPrefix(text: string, intent: CalendarFastpassIntent): string {
  if (intent === "add") {
    return text.replace(ADD_PREFIX_RE, "").trim();
  }
  if (intent === "render") {
    return text.replace(RENDER_PREFIX_RE, "").trim();
  }
  return text.replace(SHOW_PREFIX_RE, "").trim();
}

function cleanupParticipantCandidate(value: string): string {
  return value
    .replace(/^(?:我和|我们和|我跟|我们跟)/, "")
    .replace(/的$/, "")
    .replace(
      /(?:一起|开会|见面|约|沟通|讨论|review|meeting|call|吃饭|聚餐|拜访|汇报|对齐|聊|碰|面试|提醒|安排|日程|行程).*$/i,
      "",
    )
    .replace(/^[：:，,。.、\s]+|[：:，,。.、\s]+$/g, "")
    .trim();
}

function isLikelyNonPersonParticipant(candidate: string): boolean {
  return (
    !candidate ||
    GENERIC_PERSON_RE.test(candidate) ||
    NON_PERSON_PARTICIPANT_RE.test(candidate) ||
    TIME_HINT_RE.test(candidate)
  );
}

export function extractWeixinScheduleParticipants(text: string): string[] {
  const participants = new Set<string>();

  for (const match of text.matchAll(PARTICIPANT_MENTION_RE)) {
    const candidate = cleanupParticipantCandidate(match[1] ?? "");
    if (isLikelyNonPersonParticipant(candidate)) {
      continue;
    }
    participants.add(candidate);
  }

  for (const match of text.matchAll(PARTICIPANT_WITH_RE)) {
    const rawCandidate = cleanupParticipantCandidate(match[1] ?? "");
    if (!rawCandidate) {
      continue;
    }
    for (const piece of rawCandidate.split(PERSON_SPLIT_RE)) {
      const candidate = cleanupParticipantCandidate(piece);
      if (isLikelyNonPersonParticipant(candidate)) {
        continue;
      }
      participants.add(candidate);
    }
  }

  return [...participants];
}

function cleanupLocationCandidate(value: string): string {
  return value
    .replace(
      /(?:和|跟|与|同|开会|见面|约|沟通|讨论|review|meeting|call|提醒|安排|日程|行程|附件|文件|备注).*$/i,
      "",
    )
    .replace(/^[：:，,。.、\s]+|[：:，,。.、\s]+$/g, "")
    .trim();
}

function extractLocation(text: string): string | undefined {
  const labeled = text.match(LOCATION_LABEL_RE)?.[1];
  if (labeled) {
    const cleaned = cleanupLocationCandidate(labeled);
    if (cleaned) {
      return cleaned;
    }
  }

  const atLocation = text.match(LOCATION_AT_RE)?.[1];
  if (atLocation) {
    const cleaned = cleanupLocationCandidate(atLocation);
    if (cleaned) {
      return cleaned;
    }
  }

  const inline = text.match(LOCATION_INLINE_RE)?.[0];
  if (inline) {
    const cleaned = cleanupLocationCandidate(inline);
    if (cleaned) {
      return cleaned;
    }
  }

  const trailing = text.match(LOCATION_TRAILING_RE)?.[1];
  if (trailing) {
    const cleaned = cleanupLocationCandidate(trailing);
    if (cleaned) {
      return cleaned;
    }
  }

  return undefined;
}

function resolveCategory(text: string): string | undefined {
  if (/(?:开会|会议|review|meeting|call|沟通|讨论|汇报|对齐|面试)/i.test(text)) {
    return "会议";
  }
  if (/(?:代码|开发|上线|排查|debug|技术|部署|发布|联调|测试|需求评审)/i.test(text)) {
    return "技术";
  }
  if (/(?:学习|课程|读书|复盘|培训|考试|刷题)/i.test(text)) {
    return "学习";
  }
  if (/(?:出差|航班|高铁|火车|机场|车站|旅行|酒店|出发|返程)/i.test(text)) {
    return "出行";
  }
  if (/(?:医院|体检|看病|复诊|跑步|健身|瑜伽|牙医|康复)/i.test(text)) {
    return "健康";
  }
  if (/(?:家人|父母|孩子|家庭|回家|家里人)/i.test(text)) {
    return "家庭";
  }
  if (/(?:吃饭|聚餐|朋友|喝咖啡|社交|约会|客户拜访)/i.test(text)) {
    return "社交";
  }
  return undefined;
}

function resolvePriority(text: string): "high" | "normal" | "low" | undefined {
  if (/(?:紧急|重要|优先|务必|马上|尽快|asap|urgent|high priority)/i.test(text)) {
    return "high";
  }
  if (/(?:不急|低优先|有空再|low priority)/i.test(text)) {
    return "low";
  }
  return undefined;
}

function extractExplicitNote(text: string): string | undefined {
  const match = text.match(EXPLICIT_NOTE_RE)?.[1]?.trim();
  return match || undefined;
}

function resolveAttachmentEntries(
  ctx: Pick<
    FinalizedMsgContext,
    "MediaPath" | "MediaPaths" | "MediaUrl" | "MediaUrls" | "MediaType" | "MediaTypes"
  >,
): Array<{ label: string; type?: string; url?: string }> {
  const paths =
    Array.isArray(ctx.MediaPaths) && ctx.MediaPaths.length > 0
      ? ctx.MediaPaths
      : ctx.MediaPath?.trim()
        ? [ctx.MediaPath.trim()]
        : [];
  const urls =
    Array.isArray(ctx.MediaUrls) && ctx.MediaUrls.length > 0
      ? ctx.MediaUrls
      : ctx.MediaUrl?.trim()
        ? [ctx.MediaUrl.trim()]
        : [];
  const types =
    Array.isArray(ctx.MediaTypes) && ctx.MediaTypes.length > 0
      ? ctx.MediaTypes
      : ctx.MediaType?.trim()
        ? [ctx.MediaType.trim()]
        : [];
  const count = Math.max(paths.length, urls.length, types.length);
  const entries: Array<{ label: string; type?: string; url?: string }> = [];
  for (let index = 0; index < count; index += 1) {
    const filePath = paths[index]?.trim();
    const url = urls[index]?.trim();
    const type = types[index]?.trim();
    const label =
      (filePath ? path.basename(filePath) : undefined) ??
      (url ? path.basename(url.split("?")[0] ?? url) : undefined) ??
      `attachment-${index + 1}`;
    entries.push({ label, type: type || undefined, url: url || undefined });
  }
  return entries;
}

function formatAttachmentEntry(entry: { label: string; type?: string; url?: string }): string {
  const suffix = [entry.type ? `(${entry.type})` : undefined, entry.url]
    .filter(Boolean)
    .join(" | ");
  return `${entry.label}${suffix ? ` ${suffix}` : ""}`;
}

function normalizeGroundingValue(value: string | undefined): string {
  return collapseWhitespace(value).toLowerCase();
}

function isGroundedInSource(
  candidate: string | undefined,
  sourceText: string,
  attachmentEntries: Array<{ label: string; type?: string; url?: string }>,
): boolean {
  const normalizedCandidate = normalizeGroundingValue(candidate);
  if (!normalizedCandidate) {
    return false;
  }
  if (normalizeGroundingValue(sourceText).includes(normalizedCandidate)) {
    return true;
  }
  return attachmentEntries.some((entry) => {
    return [entry.label, entry.url, formatAttachmentEntry(entry)].some((value) =>
      normalizeGroundingValue(value).includes(normalizedCandidate),
    );
  });
}

function pushGroundedUnique(
  values: string[],
  seen: Set<string>,
  candidate: string | undefined,
  sourceText: string,
  attachmentEntries: Array<{ label: string; type?: string; url?: string }>,
) {
  const cleaned = collapseWhitespace(candidate);
  const key = normalizeGroundingValue(cleaned);
  if (!cleaned || !key || seen.has(key)) {
    return;
  }
  if (!isGroundedInSource(cleaned, sourceText, attachmentEntries)) {
    return;
  }
  seen.add(key);
  values.push(cleaned);
}

function extractMeetingContent(
  text: string,
  attachmentEntries: Array<{ label: string; type?: string; url?: string }>,
): string | undefined {
  const candidate = text.match(MEETING_CONTENT_LABEL_RE)?.[1]?.trim();
  if (!candidate || !isGroundedInSource(candidate, text, attachmentEntries)) {
    return undefined;
  }
  return candidate;
}

function extractMeetingLinks(
  text: string,
  attachmentEntries: Array<{ label: string; type?: string; url?: string }>,
): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  URL_RE.lastIndex = 0;
  for (const match of text.matchAll(URL_RE)) {
    pushGroundedUnique(values, seen, match[0], text, attachmentEntries);
  }
  return values;
}

function extractMeetingFiles(
  text: string,
  attachmentEntries: Array<{ label: string; type?: string; url?: string }>,
): string[] {
  const values: string[] = [];
  const seen = new Set<string>();

  for (const entry of attachmentEntries) {
    pushGroundedUnique(values, seen, formatAttachmentEntry(entry), text, attachmentEntries);
  }

  FILE_NAME_RE.lastIndex = 0;
  for (const match of text.matchAll(FILE_NAME_RE)) {
    pushGroundedUnique(values, seen, match[0], text, attachmentEntries);
  }

  const labeledFiles = text.match(MEETING_FILE_LABEL_RE)?.[1];
  if (labeledFiles) {
    pushGroundedUnique(values, seen, labeledFiles, text, attachmentEntries);
  }

  return values;
}

function buildGroundedNoteSections(
  text: string,
  ctx: Pick<
    FinalizedMsgContext,
    "MediaPath" | "MediaPaths" | "MediaUrl" | "MediaUrls" | "MediaType" | "MediaTypes"
  >,
): string | undefined {
  const attachmentEntries = resolveAttachmentEntries(ctx);
  const explicitNote = extractExplicitNote(text);
  const meetingContent = extractMeetingContent(text, attachmentEntries);
  const meetingLinks = extractMeetingLinks(text, attachmentEntries);
  const meetingFiles = extractMeetingFiles(text, attachmentEntries);
  const sections: string[] = [];

  if (explicitNote) {
    sections.push(explicitNote);
  }
  if (meetingContent) {
    sections.push(`会议内容: ${meetingContent}`);
  }
  if (meetingLinks.length > 0) {
    sections.push(["会议链接:", ...meetingLinks.map((value) => `- ${value}`)].join("\n"));
  }
  if (meetingFiles.length > 0) {
    sections.push(["会议文件:", ...meetingFiles.map((value) => `- ${value}`)].join("\n"));
  }

  return sections.join("\n\n") || undefined;
}

function extractTitle(params: {
  text: string;
  participants: string[];
  location?: string;
}): string | undefined {
  let working = params.text
    .replace(EXPLICIT_NOTE_RE, "")
    .replace(ATTACHMENT_CLAUSE_RE, "")
    .replace(MEETING_CONTENT_LABEL_RE, "")
    .replace(MEETING_FILE_LABEL_RE, "")
    .replace(MEETING_LINK_LABEL_RE, "")
    .replace(URL_RE, " ")
    .trim();
  for (const pattern of TITLE_STRIP_PATTERNS) {
    working = working.replace(pattern, " ");
  }
  if (params.location) {
    const escapedLocation = params.location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    working = working.replace(new RegExp(`(?:在|于)?\\s*${escapedLocation}(?:的)?`, "gi"), " ");
  }
  for (const participant of params.participants) {
    const escapedParticipant = participant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    working = working.replace(
      new RegExp(`(?:和|跟|与|同|约)?\\s*${escapedParticipant}`, "gi"),
      " ",
    );
  }
  working = working
    .replace(ADD_PREFIX_RE, "")
    .replace(/^(?:日程|安排|提醒|行程)[:：]?\s*/i, "")
    .replace(/^(?:(?:我(?:们)?|自己)(?:要|得|想)?|麻烦|请|帮我|替我|一下|下|的)\s*/gi, "")
    .replace(/^[和与跟同约请]\s*/g, "")
    .replace(/^[：:，,。.、\s]+|[：:，,。.、\s]+$/g, "")
    .trim();
  return working || undefined;
}

function isWeekRequest(text: string): boolean {
  return /(本周|这周|本星期|这星期|下周|上周|周历)/i.test(text);
}

function isMonthRequest(text: string): boolean {
  return /(本月|这个月|下个月|上个月|月历|月度)/i.test(text);
}

function extractRange(text: string): string | undefined {
  return text.match(RANGE_RE)?.[0]?.trim();
}

function parseNaturalNumber(value: string): number | undefined {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (/^\d+$/.test(normalized)) {
    return Number.parseInt(normalized, 10);
  }
  const digitMap: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const unitMap: Record<string, number> = {
    十: 10,
    百: 100,
  };
  let total = 0;
  let current = 0;
  let seen = false;
  for (const char of normalized) {
    if (char in digitMap) {
      current = digitMap[char] ?? 0;
      seen = true;
      continue;
    }
    if (char in unitMap) {
      total += (current || 1) * (unitMap[char] ?? 1);
      current = 0;
      seen = true;
      continue;
    }
    return undefined;
  }
  if (!seen) {
    return undefined;
  }
  return total + current;
}

function normalizeIsoDate(year: number, month: number, day: number): string | undefined {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return undefined;
  }
  const candidate = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return undefined;
  }
  return formatIsoDate(candidate);
}

function resolveDateFromWeekday(
  prefix: string | undefined,
  weekday: string,
  now = new Date(),
): string | undefined {
  const weekdayMap: Record<string, number> = {
    一: 0,
    二: 1,
    三: 2,
    四: 3,
    五: 4,
    六: 5,
    日: 6,
    天: 6,
  };
  const target = weekdayMap[weekday];
  if (target === undefined) {
    return undefined;
  }
  const current = (now.getDay() + 6) % 7;
  let diff = target - current;
  if (prefix === "下") {
    diff += 7;
  } else if (prefix === "上") {
    diff -= 7;
  } else if (!prefix && diff < 0) {
    diff += 7;
  }
  const candidate = new Date(now);
  candidate.setHours(12, 0, 0, 0);
  candidate.setDate(candidate.getDate() + diff);
  return formatIsoDate(candidate);
}

function extractExplicitDate(text: string, now = new Date()): string | undefined {
  const yearMatch = text.match(DATE_YEAR_RE);
  if (yearMatch) {
    return normalizeIsoDate(
      Number.parseInt(yearMatch[1] ?? "", 10),
      Number.parseInt(yearMatch[2] ?? "", 10),
      Number.parseInt(yearMatch[3] ?? "", 10),
    );
  }

  const monthDayMatch = text.match(DATE_MONTH_DAY_RE);
  if (monthDayMatch) {
    return normalizeIsoDate(
      now.getFullYear(),
      Number.parseInt(monthDayMatch[1] ?? "", 10),
      Number.parseInt(monthDayMatch[2] ?? "", 10),
    );
  }

  const relativeDays = [
    { pattern: /大后天/, offset: 3 },
    { pattern: /后天/, offset: 2 },
    { pattern: /(?:明天|明日|明早|明上午|明下午|明中午|明晚)/, offset: 1 },
    { pattern: /(?:今天|今日|今早|今上午|今下午|今中午|今晚)/, offset: 0 },
  ];
  for (const entry of relativeDays) {
    if (!entry.pattern.test(text)) {
      continue;
    }
    const candidate = new Date(now);
    candidate.setHours(12, 0, 0, 0);
    candidate.setDate(candidate.getDate() + entry.offset);
    return formatIsoDate(candidate);
  }

  const weekdayMatch = text.match(DATE_WEEKDAY_RE);
  if (weekdayMatch) {
    return resolveDateFromWeekday(weekdayMatch[1], weekdayMatch[2] ?? "", now);
  }

  return undefined;
}

function normalizeHour(hour: number, meridiem: string | undefined): number {
  if (!meridiem) {
    return hour;
  }
  if (/^(?:下午|傍晚|晚上|今晚|明晚|今下午|明下午)$/i.test(meridiem)) {
    return hour < 12 ? hour + 12 : hour;
  }
  if (/^(?:中午)$/i.test(meridiem)) {
    return hour < 11 ? hour + 12 : hour;
  }
  if (/^(?:凌晨|早上|上午|今早|明早|今上午|明上午)$/i.test(meridiem)) {
    return hour === 12 ? 0 : hour;
  }
  return hour;
}

function formatNormalizedTime(hour: number, minute: number): string | undefined {
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return undefined;
  }
  return `${`${hour}`.padStart(2, "0")}:${`${minute}`.padStart(2, "0")}`;
}

function extractExplicitTime(text: string): string | undefined {
  const rangeMatch = text.match(TIME_RANGE_VALUE_RE);
  if (rangeMatch) {
    return `${rangeMatch[1]}-${rangeMatch[2]}`;
  }

  const colonMatch = text.match(TIME_COLON_RE);
  if (colonMatch) {
    const hour = normalizeHour(Number.parseInt(colonMatch[2] ?? "", 10), colonMatch[1]);
    const minute = Number.parseInt(colonMatch[3] ?? "", 10);
    return formatNormalizedTime(hour, minute);
  }

  const textMatch = text.match(TIME_TEXT_RE);
  if (!textMatch) {
    return undefined;
  }
  const hour = parseNaturalNumber(textMatch[2] ?? "");
  if (hour === undefined) {
    return undefined;
  }
  let minute = 0;
  const minuteToken = (textMatch[3] ?? "").replace(/分$/i, "");
  if (minuteToken === "半") {
    minute = 30;
  } else if (minuteToken === "一刻") {
    minute = 15;
  } else if (minuteToken === "三刻") {
    minute = 45;
  } else if (minuteToken) {
    const parsedMinute = parseNaturalNumber(minuteToken);
    if (parsedMinute === undefined) {
      return undefined;
    }
    minute = parsedMinute;
  }
  return formatNormalizedTime(normalizeHour(hour, textMatch[1]), minute);
}

function resolveFutureDays(text: string): number | undefined {
  const rawValue = text.match(FUTURE_DAYS_RE)?.[1];
  if (!rawValue) {
    return undefined;
  }
  const days = parseNaturalNumber(rawValue);
  if (!days || !Number.isFinite(days) || days <= 0 || days > 366) {
    return undefined;
  }
  return days;
}

function formatIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveReminderDateParts(value: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REMINDER_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "0");
  return { year, month, day };
}

function formatReminderDigestDate(nowMs: number, dayOffset: number): string {
  const baseParts = resolveReminderDateParts(new Date(nowMs));
  const target = new Date(
    Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day + dayOffset, 12),
  );
  const parts = resolveReminderDateParts(target);
  const weekdayKey = new Intl.DateTimeFormat("en-US", {
    timeZone: REMINDER_TIMEZONE,
    weekday: "short",
  }).format(target);
  const weekdayMap: Record<string, string> = {
    Sun: "周日",
    Mon: "周一",
    Tue: "周二",
    Wed: "周三",
    Thu: "周四",
    Fri: "周五",
    Sat: "周六",
  };
  return `${parts.month}月${parts.day}日 ${weekdayMap[weekdayKey] ?? weekdayKey}`;
}

function expandCronReminderAbsoluteDate(text: string, nowMs: number): string {
  return text
    .replace(/今天的日程/g, `${formatReminderDigestDate(nowMs, 0)}的日程`)
    .replace(/明天的日程/g, `${formatReminderDigestDate(nowMs, 1)}的日程`);
}

function buildFutureRange(days: number, now = new Date()): string {
  const start = new Date(now);
  start.setHours(12, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + days - 1);
  return `${formatIsoDate(start)}~${formatIsoDate(end)}`;
}

function resolveLookupResponseMode(text: string): LookupResponseMode {
  const wantsImage = IMAGE_REQUEST_RE.test(text);
  const wantsText = TEXT_ONLY_RE.test(text) || TEXT_PREFERENCE_RE.test(text);
  if (IMAGE_ONLY_RE.test(text)) {
    return "image";
  }
  if (TEXT_ONLY_RE.test(text)) {
    return wantsImage ? "both" : "text";
  }
  if (wantsImage && wantsText) {
    return "both";
  }
  if (wantsImage) {
    return "image";
  }
  if (wantsText) {
    return "text";
  }
  return "both";
}

function resolveLookupWindow(text: string): CalendarLookupWindow {
  const futureDays = resolveFutureDays(text);
  if (futureDays) {
    return {
      kind: "range",
      range: buildFutureRange(futureDays),
      days: futureDays,
    };
  }
  const range = extractRange(text);
  if (range) {
    return {
      kind: "range",
      range,
    };
  }
  if (isMonthRequest(text)) {
    return { kind: "month" };
  }
  if (isWeekRequest(text)) {
    return { kind: "week" };
  }
  if (TIME_HINT_RE.test(text)) {
    return {
      kind: "date",
      dateText: text,
    };
  }
  return { kind: "default" };
}

function buildShowArgs(text: string, participants: string[]): string[] {
  const args = ["show"];
  const window = resolveLookupWindow(text);
  if (window.kind === "range") {
    args.push("--range", window.range);
  } else if (window.kind === "month") {
    args.push("--month");
  } else if (window.kind === "week") {
    args.push("--week");
  } else if (window.kind === "date") {
    args.push("--date", window.dateText);
  }
  if (participants[0]) {
    args.push("--with", participants[0]);
  }
  return args;
}

function buildRenderArgs(
  text: string,
  participants: string[],
): { args: string[]; view: "week" | "month" | "day" } {
  const args = ["render"];
  const window = resolveLookupWindow(text);
  let view: "week" | "month" | "day" = "week";

  if (window.kind === "month") {
    args.push("--month", "--view", "month");
    view = "month";
  } else if (window.kind === "range") {
    view = window.days === 1 ? "day" : "week";
    args.push("--range", window.range, "--view", view);
  } else if (window.kind === "date") {
    args.push("--view", "day", "--date", window.dateText);
    view = "day";
  } else {
    args.push("--week", "--view", "week");
  }

  if (participants[0]) {
    args.push("--with", participants[0]);
  }

  return {
    args,
    view,
  };
}

function buildAddArgs(
  text: string,
  ctx: Pick<
    FinalizedMsgContext,
    "MediaPath" | "MediaPaths" | "MediaUrl" | "MediaUrls" | "MediaType" | "MediaTypes"
  >,
): string[] {
  const args = ["add"];
  const participants = extractWeixinScheduleParticipants(text);
  const location = extractLocation(text);
  const category = resolveCategory(text);
  const priority = resolvePriority(text);
  const notes = buildGroundedNoteSections(text, ctx);
  const date = extractExplicitDate(text);
  const time = extractExplicitTime(text);
  const title = extractTitle({
    text,
    participants,
    location,
  });

  if (date) {
    args.push("--date", date);
  }
  if (time) {
    args.push("--time", time);
  }
  if (title) {
    args.push("--title", title);
  }
  if (category && category !== "其他") {
    args.push("--category", category);
  }
  if (participants.length > 0) {
    args.push("--with", participants.join(","));
  }
  if (location) {
    args.push("--location", location);
  }
  if (notes) {
    args.push("--notes", notes);
  }
  if (priority && priority !== "normal") {
    args.push("--priority", priority);
  }
  args.push(text);
  return args;
}

function buildCalendarCliArgs(
  intent: CalendarFastpassIntent,
  text: string,
  ctx: Pick<
    FinalizedMsgContext,
    "MediaPath" | "MediaPaths" | "MediaUrl" | "MediaUrls" | "MediaType" | "MediaTypes"
  >,
): { args: string[]; view?: "week" | "month" | "day"; responseMode?: LookupResponseMode } {
  const stripped = stripIntentPrefix(text, intent);
  const normalized = collapseWhitespace(stripped || text);
  const participants = extractWeixinScheduleParticipants(normalized);
  if (intent === "render") {
    return {
      ...buildRenderArgs(normalized, participants),
      responseMode: "image",
    };
  }
  if (intent === "show") {
    return {
      args: buildShowArgs(normalized, participants),
      responseMode: resolveLookupResponseMode(normalized),
    };
  }
  return {
    args: buildAddArgs(normalized, ctx),
  };
}

async function writeCalendarOwnerMetadata(
  calendarHome: string,
  ctx: Pick<
    FinalizedMsgContext,
    "AccountId" | "OriginatingChannel" | "OriginatingTo" | "SenderId" | "SenderName" | "SessionKey"
  >,
): Promise<void> {
  const payload = {
    channel: resolveWeixinProviderId({
      OriginatingChannel: ctx.OriginatingChannel,
      Surface: undefined,
      Provider: undefined,
    }),
    accountId: ctx.AccountId?.trim() || "default",
    to: ctx.OriginatingTo?.trim(),
    senderId: ctx.SenderId?.trim(),
    senderName: ctx.SenderName?.trim(),
    sessionKey: ctx.SessionKey?.trim(),
    updatedAt: Date.now(),
  };
  await fs.mkdir(calendarHome, { recursive: true });
  await fs.writeFile(
    path.join(calendarHome, CALENDAR_OWNER_METADATA_BASENAME),
    JSON.stringify(payload, null, 2),
    "utf8",
  );
}

function resolveRenderMediaPath(
  calendarHome: string,
  view: "week" | "month" | "day",
  stdout: string,
): string {
  const matchedPath = stdout.match(/已生成[:：]\s*(.+\.png)/i)?.[1]?.trim();
  if (matchedPath) {
    return path.isAbsolute(matchedPath) ? matchedPath : path.resolve(calendarHome, matchedPath);
  }
  return path.join(calendarHome, "output", `calendar_${view}.png`);
}

function sanitizeRenderReplyText(
  stdout: string,
  options?: { includeScheduleText?: boolean },
): string {
  const text = extractUserVisibleCliText(stdout);
  if (!text) {
    return "✅ 日历图已生成";
  }
  const cleaned = text.replace(/(✅\s*[^:\n]+)[:：]\s*(.+\.png)/i, "$1").trim();
  if (options?.includeScheduleText) {
    return cleaned;
  }
  const lines = cleaned
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(
      (line, index, items) =>
        line || items.slice(0, index).some((candidate) => candidate.trim().length > 0),
    );
  const kept: string[] = [];
  for (const line of lines) {
    kept.push(line);
    if (/^✅\s*/.test(line.trim())) {
      break;
    }
  }
  return kept.join("\n").trim() || "✅ 日历图已生成";
}

function resolveFailureText(
  intent: CalendarFastpassIntent,
  stdout: string,
  stderr: string,
): string {
  const output = extractUserVisibleCliText(stdout) || extractUserVisibleCliText(stderr);
  if (output) {
    return output;
  }
  if (intent === "add") {
    return "❌ 日程添加失败";
  }
  if (intent === "render") {
    return "❌ 日历图片生成失败";
  }
  return "❌ 日程查询失败";
}

function isUserOriginatedWeixinDirectContext(
  ctx: Pick<FinalizedMsgContext, "ChatType" | "OriginatingChannel" | "Surface" | "Provider">,
): boolean {
  if (!isWeixinDirectContext(ctx)) {
    return false;
  }
  const provider = ctx.Provider?.trim().toLowerCase();
  const surface = ctx.Surface?.trim().toLowerCase();
  return provider === WEIXIN_PROVIDER_ID || surface === WEIXIN_PROVIDER_ID;
}

function resolveReminderScopeKey(
  ctx: Pick<
    FinalizedMsgContext,
    | "SessionKey"
    | "AccountId"
    | "OriginatingTo"
    | "SenderId"
    | "From"
    | "ChatType"
    | "OriginatingChannel"
    | "Surface"
    | "Provider"
  >,
): { scopeKey: string; sessionKey: string } | undefined {
  if (!isUserOriginatedWeixinDirectContext(ctx)) {
    return undefined;
  }
  const sessionKey = ctx.SessionKey?.trim();
  if (!sessionKey) {
    return undefined;
  }
  const scoped = parseWeixinDirectSessionScope(ctx.SessionKey);
  const accountId = scoped?.accountId ?? ctx.AccountId?.trim() ?? "default";
  const peerId =
    scoped?.peerId ?? ctx.OriginatingTo?.trim() ?? ctx.SenderId?.trim() ?? ctx.From?.trim();
  if (!peerId) {
    return undefined;
  }
  return {
    scopeKey: `${encodePathSegment(accountId)}:${encodePathSegment(peerId.toLowerCase())}`,
    sessionKey,
  };
}

function buildDailyReminderJobs(
  ctx: Pick<
    FinalizedMsgContext,
    | "SessionKey"
    | "AccountId"
    | "OriginatingTo"
    | "SenderId"
    | "From"
    | "ChatType"
    | "OriginatingChannel"
    | "Surface"
    | "Provider"
  >,
): CronJobCreate[] {
  const scope = resolveReminderScopeKey(ctx);
  if (!scope) {
    return [];
  }
  const base = {
    description: REMINDER_DESCRIPTION,
    enabled: true,
    sessionTarget: "main" as const,
    wakeMode: "now" as const,
    sessionKey: scope.sessionKey,
  };
  return [
    {
      ...base,
      name: `${REMINDER_JOB_NAME_PREFIX}:${scope.scopeKey}:today-0900`,
      schedule: { kind: "cron", expr: "0 9 * * *", tz: REMINDER_TIMEZONE, staggerMs: 0 },
      payload: { kind: "systemEvent", text: "发我今天的日程，文字总结版和日历图片都要" },
    },
    {
      ...base,
      name: `${REMINDER_JOB_NAME_PREFIX}:${scope.scopeKey}:tomorrow-2200`,
      schedule: { kind: "cron", expr: "0 22 * * *", tz: REMINDER_TIMEZONE, staggerMs: 0 },
      payload: { kind: "systemEvent", text: "发我明天的日程，文字总结版和日历图片都要" },
    },
  ];
}

function isEquivalentReminderJob(job: CronJob, spec: CronJobCreate): boolean {
  return (
    job.name === spec.name &&
    job.description === spec.description &&
    job.enabled === spec.enabled &&
    job.sessionTarget === spec.sessionTarget &&
    job.wakeMode === spec.wakeMode &&
    job.sessionKey === spec.sessionKey &&
    job.payload.kind === "systemEvent" &&
    spec.payload.kind === "systemEvent" &&
    job.payload.text === spec.payload.text &&
    job.schedule.kind === "cron" &&
    spec.schedule.kind === "cron" &&
    job.schedule.expr === spec.schedule.expr &&
    job.schedule.tz === spec.schedule.tz &&
    (job.schedule.staggerMs ?? 0) === (spec.schedule.staggerMs ?? 0) &&
    !job.delivery
  );
}

async function dispatchGatewayReminderSync(
  jobs: CronJobCreate[],
  dispatchGateway: <T>(method: string, params: Record<string, unknown>) => Promise<T>,
): Promise<boolean> {
  const listed = await dispatchGateway<{ jobs?: CronJob[] }>("cron.list", {
    includeDisabled: true,
  });
  const existingJobs = Array.isArray(listed?.jobs) ? listed.jobs : [];
  let changed = false;

  for (const spec of jobs) {
    const matching = existingJobs.filter((job) => job.name === spec.name);
    const equivalent = matching.find((job) => isEquivalentReminderJob(job, spec));
    const stale = equivalent ? matching.filter((job) => job.id !== equivalent.id) : matching;

    for (const job of stale) {
      await dispatchGateway("cron.remove", { id: job.id });
      changed = true;
    }

    if (!equivalent) {
      await dispatchGateway("cron.add", spec);
      changed = true;
    }
  }

  return changed;
}

function buildFallbackCronState(storePath: string, nowMs: () => number) {
  return createCronServiceState({
    nowMs,
    log: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    storePath,
    cronEnabled: true,
    defaultAgentId: "main",
    enqueueSystemEvent: () => undefined,
    requestHeartbeatNow: () => undefined,
    runIsolatedAgentJob: async () => ({
      status: "skipped",
      summary: "bundled-skill-fastpass-fallback",
    }),
  });
}

async function fallbackReminderStoreSync(
  jobs: CronJobCreate[],
  storePath: string,
  nowMs: () => number,
): Promise<boolean> {
  const store = await loadCronStore(storePath);
  const state = buildFallbackCronState(storePath, nowMs);
  let changed = false;

  for (const spec of jobs) {
    const matching = store.jobs.filter((job) => job.name === spec.name);
    const equivalent = matching.find((job) => isEquivalentReminderJob(job, spec));
    const keptIds = equivalent ? new Set([equivalent.id]) : new Set<string>();
    const nextJobs = store.jobs.filter((job) => job.name !== spec.name || keptIds.has(job.id));
    if (nextJobs.length !== store.jobs.length) {
      store.jobs = nextJobs;
      changed = true;
    }
    if (!equivalent) {
      store.jobs.push(createJob(state, spec));
      changed = true;
    }
  }

  if (changed) {
    await saveCronStore(storePath, store);
  }
  return changed;
}

async function syncWeixinDailyReminderJobs(
  params: {
    ctx: Pick<
      FinalizedMsgContext,
      | "SessionKey"
      | "AccountId"
      | "OriginatingTo"
      | "SenderId"
      | "From"
      | "ChatType"
      | "OriginatingChannel"
      | "Surface"
      | "Provider"
    >;
    cfg?: OpenClawConfig;
  },
  deps: Pick<CalendarCliDeps, "cronStorePath" | "nowMs" | "dispatchGateway">,
): Promise<void> {
  const jobs = buildDailyReminderJobs(params.ctx);
  if (jobs.length === 0) {
    return;
  }

  const dispatchGateway =
    deps.dispatchGateway ??
    (await loadGatewayInternalDispatchRuntime()
      .then((mod) => {
        return <T>(method: string, gatewayParams: Record<string, unknown>) =>
          mod.dispatchInternalGatewayMethod<T>(method, gatewayParams, {
            syntheticScopes: ["admin"],
          });
      })
      .catch(() => undefined));

  if (dispatchGateway) {
    try {
      await dispatchGatewayReminderSync(jobs, dispatchGateway);
      return;
    } catch (error) {
      logVerbose(
        `bundled-skill-fastpass: gateway reminder sync failed, falling back to store sync: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const cfg = params.cfg ?? loadConfig();
  const storePath = resolveCronStorePath(deps.cronStorePath ?? cfg.cron?.store);
  await fallbackReminderStoreSync(jobs, storePath, deps.nowMs ?? (() => Date.now()));
}

export async function tryHandleBundledSkillFastpass(
  params: {
    ctx: FinalizedMsgContext;
    cfg?: OpenClawConfig;
  },
  deps: CalendarCliDeps = {},
): Promise<BundledSkillFastpassResult> {
  const { ctx } = params;
  const rawSourceText = resolveSourceText(ctx);
  const sourceText =
    ctx.Provider === "cron-event"
      ? expandCronReminderAbsoluteDate(rawSourceText, deps.nowMs?.() ?? Date.now())
      : rawSourceText;
  const intent = resolveCalendarIntent(sourceText);
  if (!intent) {
    return { handled: false };
  }

  const calendarHome = resolveWeixinCalendarHome({
    ctx,
    env: deps.env,
    stateDir: deps.stateDir,
  });
  if (!calendarHome) {
    return { handled: false };
  }

  const { args, view, responseMode } = buildCalendarCliArgs(intent, sourceText, ctx);
  const queryText =
    intent === "add"
      ? undefined
      : collapseWhitespace(stripIntentPrefix(sourceText, intent) || sourceText);
  const queryParticipants = queryText ? extractWeixinScheduleParticipants(queryText) : [];
  const execFile = deps.execFile ?? execFileUtf8;
  const calendarScriptPath = deps.calendarScriptPath ?? resolveCalendarScriptPath();
  const env = {
    ...process.env,
    ...deps.env,
    SMART_CALENDAR_HOME: calendarHome,
  };

  try {
    await writeCalendarOwnerMetadata(calendarHome, ctx);
  } catch (error) {
    logVerbose(
      `bundled-skill-fastpass: failed to write calendar owner metadata for ${calendarHome}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const runCalendarCli = async (cliArgs: string[]) => {
    logVerbose(
      `bundled-skill-fastpass: running calendar CLI home=${calendarHome} args=${JSON.stringify(cliArgs)}`,
    );
    return execFile("bash", [calendarScriptPath, ...cliArgs], {
      env,
      maxBuffer: 8 * 1024 * 1024,
    });
  };

  const result = await runCalendarCli(args);

  if (result.code !== 0) {
    return {
      handled: true,
      payload: {
        text: resolveFailureText(intent, result.stdout, result.stderr),
      },
      reason: `bundled_skill_fastpass_${intent}_error`,
    };
  }

  try {
    await syncWeixinDailyReminderJobs(params, deps);
  } catch (error) {
    logVerbose(
      `bundled-skill-fastpass: failed to sync daily reminder jobs: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (intent === "render") {
    const mediaUrl = resolveRenderMediaPath(calendarHome, view ?? "week", result.stdout);
    return {
      handled: true,
      payload: {
        text: sanitizeRenderReplyText(result.stdout),
        mediaUrl,
      },
      reason: "bundled_skill_fastpass_calendar_render",
    };
  }

  const showText =
    extractUserVisibleCliText(result.stdout) ||
    (intent === "add" ? "✅ 日程已添加" : "📅 日程查询完成");

  if (intent === "show" && responseMode !== "text") {
    const renderSpec = buildRenderArgs(queryText ?? sourceText, queryParticipants);
    const renderResult = await runCalendarCli(renderSpec.args);
    if (renderResult.code !== 0) {
      return {
        handled: true,
        payload: {
          text:
            responseMode === "both"
              ? `${showText}\n\n${resolveFailureText("render", renderResult.stdout, renderResult.stderr)}`
              : resolveFailureText("render", renderResult.stdout, renderResult.stderr),
        },
        reason:
          responseMode === "both"
            ? "bundled_skill_fastpass_calendar_show"
            : "bundled_skill_fastpass_calendar_render_error",
      };
    }
    const mediaUrl = resolveRenderMediaPath(calendarHome, renderSpec.view, renderResult.stdout);
    return {
      handled: true,
      payload: {
        text: showText,
        mediaUrl,
      },
      reason:
        responseMode === "both"
          ? "bundled_skill_fastpass_calendar_show_render"
          : "bundled_skill_fastpass_calendar_render",
    };
  }

  return {
    handled: true,
    payload: {
      text: showText,
    },
    reason:
      intent === "add"
        ? "bundled_skill_fastpass_calendar_add"
        : "bundled_skill_fastpass_calendar_show",
  };
}

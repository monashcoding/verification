export interface LinkStatus {
  linked: boolean;
  canEnterStudentId: boolean;
  contactUs: boolean;
  attemptsRemaining?: number;
}

export type EventOutcome =
  | { state: 'code_ready'; autoApplyUrl: string }
  | { state: 'not_member'; ticketUrl: string };

export interface EventView {
  slug: string;
  name: string;
  description: string | null;
  bannerImageUrl: string | null;
  venueName: string | null;
  startDate: string | null;
  endDate: string | null;
  outcome: EventOutcome;
}

export interface EventStatusResponse {
  mode: 'event';
  link: LinkStatus;
  event: EventView;
}

export interface GenericStatusResponse {
  mode: 'generic';
  link: LinkStatus;
  events: EventView[];
}

/** Signed-out view of one event (§7): the card plus the plain ticket link. */
export interface PublicEventResponse {
  mode: 'public';
  event: EventView;
}

/** A slug we know but no longer serve — retired or simply past. */
export interface EndedEventResponse {
  mode: 'ended';
  event: { slug: string; name: string; endDate: string | null };
}

export type PublicEventLookup = PublicEventResponse | EndedEventResponse;

/** Signed-out view of the whole active-events list (the "browse" path). */
export interface PublicEventsResponse {
  mode: 'public';
  events: EventView[];
}

export type StatusResponse = EventStatusResponse | GenericStatusResponse;

export interface StudentIdRetryResponse {
  linked: false;
  message: string;
  attemptsRemaining: number;
}

export interface RosterSummary {
  hasRoster: boolean;
  total: number;
  enrolled: number;
  inactive: number;
  importedAt?: string;
  importBatchId?: string;
}

export interface EventAdmin {
  id: number;
  name: string;
  slug: string;
  humanitixEventUrl: string;
  /** Set when the event came from the Humanitix API; null for manual entries. */
  humanitixEventId: string | null;
  active: boolean;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  codeCount: number;
  /** Codes marked as sent out (downloaded or posted to Discord). */
  exportedCount: number;
  /** An officer undid the download — no discount links, no auto-export. */
  codesOnHold: boolean;
}

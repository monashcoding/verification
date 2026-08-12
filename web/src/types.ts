export interface LinkStatus {
  linked: boolean;
  canEnterStudentId: boolean;
  contactUs: boolean;
  attemptsRemaining?: number;
}

export type EventOutcome =
  | { state: 'code_ready'; autoApplyUrl: string }
  | { state: 'pending' }
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
}

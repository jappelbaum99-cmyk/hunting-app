import { Icon } from '@/components/Icon';

// Where a saved pin or walk stands: kept only on the phone, waiting for signal,
// at camp, or handled on the hub.
export type SentStatus = 'local' | 'waiting' | 'sent' | 'added' | 'dismissed';

const SENT_LABELS: Record<SentStatus, string> = {
  local: '',
  waiting: 'Waiting to send',
  sent: 'At camp',
  added: 'On the hub map',
  dismissed: 'Dismissed on the hub',
};

export function SentBadge({ status }: { status: SentStatus }) {
  if (status === 'local') return null;
  return <span className={`sent-badge ${status}`}>{SENT_LABELS[status]}</span>;
}

// Resend everything, or clear what the hub has already handled.
export function SentTools(props: {
  items: { id: string; updatedAt: string }[];
  status(item: { id: string; updatedAt: string }): SentStatus;
  what: string;
  onResend(): void;
  onClear(): void;
}) {
  const handled = props.items.filter((i) => ['added', 'dismissed'].includes(props.status(i))).length;
  if (props.items.length === 0) return null;
  return (
    <div className="sent-tools">
      {handled > 0 && (
        <button onClick={props.onClear}>
          <Icon name="check" size={16} /> Clear {handled} on the hub
        </button>
      )}
      <button onClick={props.onResend}>
        <Icon name="send" size={16} /> Resend all
      </button>
    </div>
  );
}


import { PushNotifications } from './PushNotifications';
import { TelegramConnect } from './TelegramConnect';

type Identity = {
  uid: string;
  provider: 'google' | 'telegram';
  telegramLinked: boolean;
  telegramNotifications: boolean;
};

type Props = {
  token: string;
  identity: Identity | null;
  taskCount: number;
  syncStatus: string;
  onLogout: () => void;
  onLinked: () => void;
  onRefresh: () => void;
};

/** Compact controls above the planner's goals and task lists.
 * Keeps personal account actions out of the main task content.
 */
export function PlannerSignedInTools({ token, identity, taskCount, syncStatus, onLogout, onLinked, onRefresh }: Props) {
  return (
    <section className="planner-utility-bar" aria-label="Звуки, обновление и аккаунт">
      <PushNotifications token={token} compact />
      <button type="button" className="planner-utility-button" onClick={onRefresh} aria-label="Обновить Планер" >
        <span aria-hidden="true">🔄</span><span>Обновить</span>
      </button>
      <details className="planner-account-menu">
        <summary className="planner-utility-button" aria-label="Открыть настройки аккаунта">
          <span aria-hidden="true">👤</span>
          <span>Аккаунт</span>
          <span className="planner-account-chevron" aria-hidden="true">⌄</span>
        </summary>
        <div className="planner-account-panel">
          <p className="planner-account-title">Личный аккаунт</p>
          <p className="planner-account-row"><span className="planner-account-status" aria-hidden="true" /> {syncStatus} · {taskCount} задач</p>
          <p className="planner-account-row">
            {identity?.provider === 'telegram' || identity?.telegramLinked
              ? '✈ Telegram подключён'
              : 'Облачная синхронизация активна'}
          </p>
          {identity?.telegramLinked && (
            <p className="planner-account-note">
              Напоминания Telegram: {identity.telegramNotifications ? 'включены' : 'отключены'}.
              Для изменения используйте /start или /stop у бота.
            </p>
          )}
          {identity?.provider === 'google' && !identity.telegramLinked && (
            <TelegramConnect mode="link" token={token} onLinked={onLinked} />
          )}
          <button className="planner-account-logout" type="button" onClick={onLogout}>
            Выйти из аккаунта
          </button>
        </div>
      </details>
    </section>
  );
}

export default function Notification({ notification, onClose }) {
  if (!notification) return null;

  return (
    <div
      className={`notification-banner ${notification.type}`}
      role={notification.type === "error" ? "alert" : "status"}
      aria-live={notification.type === "error" ? "assertive" : "polite"}
    >
      <span className="notification-icon">
        {notification.type === "success" ? "✓" : "!"}
      </span>
      <span className="notification-text">{notification.message}</span>
      <button
        className="notification-close"
        onClick={onClose}
        aria-label="Close notification"
        type="button"
      >
        ×
      </button>
    </div>
  );
}

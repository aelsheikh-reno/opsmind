export default function SuspendedPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path
                d="M16 4L29 27H3L16 4Z"
                stroke="#d97706"
                strokeWidth="2"
                strokeLinejoin="round"
                fill="none"
              />
              <path d="M16 13v6" stroke="#d97706" strokeWidth="2" strokeLinecap="round" />
              <circle cx="16" cy="23" r="1.2" fill="#d97706" />
            </svg>
          </div>
        </div>

        {/* Heading */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-gray-900">Subscription paused</h1>
          <p className="text-gray-500 text-sm leading-relaxed">
            Your OpsMind license has expired or is not configured.
            Please contact your provider to renew access.
          </p>
        </div>

        {/* Contact box */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 text-left space-y-1">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Contact</p>
          <p className="text-sm font-medium text-gray-800">Reno Systems</p>
          <a
            href="mailto:support@reno.systems"
            className="text-sm text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            support@reno.systems
          </a>
        </div>

        <p className="text-xs text-gray-400">
          Once renewed, access is restored instantly — no redeploy needed.
        </p>
      </div>
    </div>
  );
}

type ComingSoonProps = {
  icon: string;
  description: string;
};

export default function ComingSoon({ icon, description }: ComingSoonProps) {
  return (
    <div className="bg-white border border-surface-border rounded-xl p-16 flex flex-col items-center gap-3 text-center">
      <div className="w-14 h-14 rounded-full bg-indigo-50 flex items-center justify-center text-2xl mb-1">
        {icon}
      </div>
      <p className="text-sm font-semibold text-gray-700">Coming soon</p>
      <p className="text-sm text-gray-400 max-w-sm">{description}</p>
      <span className="mt-2 text-xs font-medium text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">
        In development
      </span>
    </div>
  );
}

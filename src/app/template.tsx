// Remounts on every navigation, so client-side route changes fade in too.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-fade">{children}</div>;
}

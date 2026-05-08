import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';

const navItems = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/studies', label: 'Studies' },
  { href: '/dashboard/settings', label: 'Settings' },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/login');
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 shrink-0 border-r bg-white px-4 py-6">
        <div className="mb-8">
          <span className="font-semibold text-gray-900">Researcher Dashboard</span>
          <p className="mt-1 truncate text-xs text-gray-400">{user.email}</p>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto pt-8">
          <form action="/auth/signout" method="POST">
            <button
              type="submit"
              className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-100"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-gray-50 p-8">{children}</main>
    </div>
  );
}

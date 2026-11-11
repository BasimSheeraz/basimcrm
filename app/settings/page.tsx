import { redirect } from 'next/navigation';

export default function SettingsRedirect({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const query = new URLSearchParams();
  query.set('view', 'settings');

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === 'string') {
        query.set(key, value);
      }
    }
  }

  redirect(`/?${query.toString()}`);
}

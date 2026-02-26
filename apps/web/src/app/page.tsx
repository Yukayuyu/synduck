import { redirect } from 'next/navigation';
import { isLoggedIn } from '@/lib/auth';

export default function Home() {
  if (typeof window !== 'undefined' && isLoggedIn()) {
    redirect('/graphs');
  } else {
    redirect('/graphs/public');
  }
}
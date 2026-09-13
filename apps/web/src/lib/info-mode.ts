import { cookies } from 'next/headers';

/** Directory presentation: plain decision-relevant statements, or the compact technical index. */
export type InfoMode = 'simple' | 'technical';

export const INFO_MODE_COOKIE = 'mutinai_info';

export async function getInfoMode(): Promise<InfoMode> {
  return (await cookies()).get(INFO_MODE_COOKIE)?.value === 'technical' ? 'technical' : 'simple';
}

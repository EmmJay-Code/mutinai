import { catalog, getDb } from '@mutinai/db';
import type { NextRequest } from 'next/server';
import { publicJson } from '@/lib/api';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const kinds = req.nextUrl.searchParams.getAll('kind');
  return publicJson(await catalog.searchEntities(getDb(), q, { kinds: kinds.length ? kinds : undefined, limit: 50 }));
}

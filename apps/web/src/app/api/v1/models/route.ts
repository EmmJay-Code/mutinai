import { catalog, getDb } from '@mutinai/db';
import type { NextRequest } from 'next/server';
import { publicJson } from '@/lib/api';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const num = (k: string) => (p.get(k) ? Number(p.get(k)) : undefined);
  const models = await catalog.listModels(getDb(), {
    q: p.get('q') ?? undefined,
    family: p.get('family') ?? undefined,
    developer: p.get('developer') ?? undefined,
    architecture: (p.get('architecture') as 'dense' | 'moe' | null) ?? undefined,
    capability: p.get('capability') ?? undefined,
    minParamsB: num('min_params_b'),
    maxParamsB: num('max_params_b'),
  });
  return publicJson(models);
}

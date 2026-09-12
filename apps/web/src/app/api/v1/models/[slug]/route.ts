import { catalog, getDb } from '@mutinai/db';
import { notFoundJson, publicJson } from '@/lib/api';

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const model = await catalog.getModelDetail(getDb(), (await params).slug);
  return model ? publicJson(model) : notFoundJson();
}

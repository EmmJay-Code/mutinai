import { sql } from 'drizzle-orm';
import type { Executor } from './client';

/**
 * Rebuilds `entity.search_text` (aliases + names of related entities) which feeds the generated tsvector.
 * Runs for the given entities, or all entities when `ids` is omitted.
 */
export async function refreshSearchText(db: Executor, ids?: string[]): Promise<number> {
  if (ids && ids.length === 0) return 0;
  const filter = ids ? sql`e.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})` : sql`true`;
  const rows = await db.execute(sql`
    update ecosystem.entity e set search_text = trim(concat_ws(' ',
      (select string_agg(a.alias, ' ') from ecosystem.entity_alias a where a.entity_id = e.id),
      case e.kind
        when 'model_variant' then (
          select concat_ws(' ', me.name, fe.name, oe.name, v.variant_kind::text, array_to_string(v.capabilities, ' '))
          from ecosystem.model_variant v
          join ecosystem.model m on m.id = v.model_id
          join ecosystem.entity me on me.id = m.id
          join ecosystem.model_release r on r.id = m.release_id
          join ecosystem.model_family f on f.id = r.family_id
          join ecosystem.entity fe on fe.id = f.id
          join ecosystem.entity oe on oe.id = f.developer_org_id
          where v.id = e.id)
        when 'model' then (
          select concat_ws(' ', re.name, fe.name, oe.name, m.architecture::text)
          from ecosystem.model m
          join ecosystem.entity re on re.id = m.release_id
          join ecosystem.model_release r on r.id = m.release_id
          join ecosystem.entity fe on fe.id = r.family_id
          join ecosystem.model_family f on f.id = r.family_id
          join ecosystem.entity oe on oe.id = f.developer_org_id
          where m.id = e.id)
        when 'model_artifact' then (
          select concat_ws(' ', ve.name, se.name, pe.name, a.format::text, a.source_repo)
          from ecosystem.model_artifact a
          join ecosystem.entity ve on ve.id = a.variant_id
          join ecosystem.entity se on se.id = a.scheme_id
          join ecosystem.entity pe on pe.id = a.publisher_org_id
          where a.id = e.id)
        when 'hardware_device' then (
          select concat_ws(' ', oe.name, d.device_kind::text, d.memory_type, array_to_string(d.backends, ' '))
          from ecosystem.hardware_device d join ecosystem.entity oe on oe.id = d.vendor_org_id where d.id = e.id)
        when 'hardware_configuration' then (
          select string_agg(de.name, ' ')
          from ecosystem.hardware_configuration_component c join ecosystem.entity de on de.id = c.device_id
          where c.configuration_id = e.id)
        when 'project' then (
          select concat_ws(' ', p.category::text, p.repo_url, p.primary_language) from ecosystem.project p where p.id = e.id)
        when 'model_release' then (
          select concat_ws(' ', fe.name) from ecosystem.model_release r join ecosystem.entity fe on fe.id = r.family_id where r.id = e.id)
        else null
      end
    )), updated_at = updated_at
    where ${filter}
    returning e.id`);
  return rows.length;
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { getTemplates, resetTemplates, saveTemplates } from "../api";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";

type TemplateItem = {
  key: string;
  path?: string[];
  value: string;
};

type TemplateGroup = {
  group: string;
  label: string;
  templates: TemplateItem[];
};

function normalizeGroups(groups: TemplateGroup[] = []) {
  return Array.isArray(groups) ? groups : [];
}

export function Templates() {
  const queryClient = useQueryClient();
  const { data } = useQuery<any>({ queryKey: ["templates"], queryFn: getTemplates });
  const [overrides, setOverrides] = useState<Record<string, Record<string, string>>>({});
  const groups = useMemo(() => normalizeGroups(data?.groups), [data]);
  useEffect(() => {
    if (!groups.length) return;
    setOverrides((current) => {
      if (Object.keys(current).length) return current;
      const next: Record<string, Record<string, string>> = {};
      for (const group of groups) {
        next[group.group] = {};
        for (const template of group.templates) next[group.group][template.key] = template.value;
      }
      return next;
    });
  }, [groups]);
  const save = useMutation({ mutationFn: () => saveTemplates(overrides), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["templates"] }) });
  const reset = useMutation({ mutationFn: resetTemplates, onSuccess: () => { setOverrides({}); queryClient.invalidateQueries({ queryKey: ["templates"] }); } });
  return (
    <main className="page-shell">
      <PageHeader eyebrow="Content" title="Templates" subtitle="Edit bot copy and emoji variants safely before pushing live." right={<><button type="button" onClick={() => save.mutate()}>Save</button><button type="button" onClick={() => reset.mutate()}>Reset</button></>} />
      <div className="page-scroll">
        {groups.map((group) => (
          <Panel title={group.label || group.group} key={group.group}>
            <div className="template-grid">
              {(group.templates || []).map((template) => (
                <label className="template-editor" key={template.key}>
                  <span>{template.key}</span>
                  <textarea value={overrides[group.group]?.[template.key] ?? template.value} onChange={(event) => setOverrides((current) => ({ ...current, [group.group]: { ...(current[group.group] || {}), [template.key]: event.target.value } }))} />
                </label>
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </main>
  );
}

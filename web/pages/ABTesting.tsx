import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { getAbTests, pushAbWinner, saveAbTests } from "../api";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";

type TemplateRow = {
  group: string;
  groupLabel: string;
  key: string;
  body: string;
  sends: number;
  replies: number;
  responseRate: number;
};

type Experiment = {
  id: string;
  name: string;
  group: string;
  key: string;
  status: "draft" | "active" | "paused" | "winner";
  variants: Array<{ id: string; name: string; body: string; weight: number; sends?: number; replies?: number; responseRate?: number }>;
};

function pct(value = 0) {
  return `${Math.round(value * 1000) / 10}%`;
}

export function ABTesting() {
  const queryClient = useQueryClient();
  const { data } = useQuery<any>({ queryKey: ["ab-tests"], queryFn: getAbTests });
  const templates: TemplateRow[] = data?.templatePerformance || [];
  const experiments: Experiment[] = data?.experiments || [];
  const [selectedKey, setSelectedKey] = useState("");
  const selected = useMemo(() => templates.find((row) => `${row.group}:${row.key}` === selectedKey) || templates[0], [selectedKey, templates]);
  const currentExperiment = experiments.find((item) => item.group === selected?.group && item.key === selected?.key);
  const [variantBody, setVariantBody] = useState("");
  const [variantName, setVariantName] = useState("Emoji test");

  useEffect(() => {
    if (!selectedKey && templates[0]) setSelectedKey(`${templates[0].group}:${templates[0].key}`);
  }, [selectedKey, templates]);

  useEffect(() => {
    if (!selected) return;
    setVariantBody(selected.body);
    setVariantName("Emoji test");
  }, [selected?.group, selected?.key]);

  const saveExperiment = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("Choose a template first.");
      const next: Experiment = {
        id: currentExperiment?.id || `${selected.group}:${selected.key}:${Date.now()}`,
        name: currentExperiment?.name || `${selected.groupLabel} ${selected.key}`,
        group: selected.group,
        key: selected.key,
        status: "active",
        variants: [
          { id: "control", name: "Control", body: selected.body, weight: 50 },
          { id: "variant_2", name: variantName || "Variant 2", body: variantBody || selected.body, weight: 50 }
        ]
      };
      const others = experiments.filter((item) => item.id !== next.id);
      return saveAbTests([...others, next]);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ab-tests"] })
  });

  const pushWinner = useMutation({
    mutationFn: ({ experimentId, variantId }: any) => pushAbWinner(experimentId, variantId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ab-tests"] })
  });

  return (
    <main className="page-shell">
      <PageHeader eyebrow="Experiments" title="A/B Testing" subtitle="Review current scripts, compare response rates, and push winning copy live." />
      <div className="page-scroll ab-layout">
        <Panel title="Current scripts and performance">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Script</th>
                  <th>Sends</th>
                  <th>Replies</th>
                  <th>Reply rate</th>
                  <th>Use</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((row) => (
                  <tr key={`${row.group}:${row.key}`}>
                    <td>
                      <strong>{row.groupLabel}</strong>
                      <span className="cell-sub">{row.key}</span>
                    </td>
                    <td>{row.sends || 0}</td>
                    <td>{row.replies || 0}</td>
                    <td>{pct(row.responseRate)}</td>
                    <td><button type="button" onClick={() => setSelectedKey(`${row.group}:${row.key}`)}>Edit test</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title={selected ? `Create test: ${selected.groupLabel} / ${selected.key}` : "Create test"}>
          {selected ? (
            <div className="experiment-editor">
              <label>
                <span>Control script</span>
                <textarea value={selected.body} readOnly />
              </label>
              <label>
                <span>Variant name</span>
                <input value={variantName} onChange={(event) => setVariantName(event.target.value)} />
              </label>
              <label>
                <span>Variant script</span>
                <textarea value={variantBody} onChange={(event) => setVariantBody(event.target.value)} />
              </label>
              <button className="primary" type="button" onClick={() => saveExperiment.mutate()}>
                Save 50/50 active test
              </button>
            </div>
          ) : <p className="small muted-pad">No templates are available yet.</p>}
        </Panel>

        <Panel title="Active experiments">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Experiment</th>
                  <th>Status</th>
                  <th>Variant</th>
                  <th>Sends</th>
                  <th>Replies</th>
                  <th>Rate</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {experiments.flatMap((exp) => (exp.variants || []).map((variant) => (
                  <tr key={`${exp.id}-${variant.id}`}>
                    <td>{exp.name || exp.id}</td>
                    <td>{exp.status}</td>
                    <td>{variant.name || variant.id}</td>
                    <td>{variant.sends || 0}</td>
                    <td>{variant.replies || 0}</td>
                    <td>{pct(variant.responseRate)}</td>
                    <td><button type="button" onClick={() => pushWinner.mutate({ experimentId: exp.id, variantId: variant.id })}>Push live</button></td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </main>
  );
}

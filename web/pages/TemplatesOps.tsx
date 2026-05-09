import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAbTests, pushAbWinner, saveAbTests, saveTemplates } from "../api";
import type { DashboardData } from "../types";
import { pct, safeText, shortBody } from "../safe";
import { Empty, Panel } from "../components/OpsPrimitives";

export function TemplatesOps({ data }: { data?: DashboardData }) {
  const queryClient = useQueryClient();
  const { data: abData } = useQuery<any>({ queryKey: ["ab-tests"], queryFn: getAbTests });
  const templates = abData?.templatePerformance || data?.templatePerformance || [];
  const experiments = abData?.experiments || data?.abTesting || [];
  const [selectedKey, setSelectedKey] = useState("");
  const selected = useMemo(() => templates.find((row: any) => `${row.group}:${row.key}` === selectedKey) || templates[0], [selectedKey, templates]);
  const [variantName, setVariantName] = useState("Emoji variant");
  const [variantBody, setVariantBody] = useState("");
  const [liveBody, setLiveBody] = useState("");

  useEffect(() => {
    if (!selectedKey && templates[0]) setSelectedKey(`${templates[0].group}:${templates[0].key}`);
  }, [selectedKey, templates]);

  useEffect(() => {
    if (!selected) return;
    setVariantBody(selected.body || "");
    setLiveBody(selected.body || "");
  }, [selected?.group, selected?.key]);

  const saveExperiment = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("Choose a template first.");
      const current = experiments.find((item: any) => item.group === selected.group && item.key === selected.key);
      const next = {
        id: current?.id || `${selected.group}:${selected.key}:${Date.now()}`,
        name: current?.name || `${selected.groupLabel || selected.group} ${selected.key}`,
        group: selected.group,
        key: selected.key,
        status: "active",
        variants: [
          { id: "control", name: "Control", body: selected.body, weight: 50 },
          { id: "variant_2", name: variantName || "Variant 2", body: variantBody || selected.body, weight: 50 }
        ]
      };
      return saveAbTests([...experiments.filter((item: any) => item.id !== next.id), next]);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ab-tests"] })
  });

  const pushWinner = useMutation({
    mutationFn: ({ experimentId, variantId }: any) => pushAbWinner(experimentId, variantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ab-tests"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    }
  });

  const pushLive = useMutation({
    mutationFn: () => saveTemplates({ [selected.group]: { [selected.key]: liveBody } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ab-tests"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    }
  });

  return (
    <section className="page-content template-layout">
      <Panel title="Current scripts" subtitle="Every live script should be visible before we test or edit it.">
        <table className="data-table">
          <thead><tr><th>Script</th><th>Sends</th><th>Replies</th><th>Rate</th><th>Preview</th><th>Action</th></tr></thead>
          <tbody>
            {templates.map((row: any) => (
              <tr key={`${row.group}:${row.key}`}>
                <td><strong>{safeText(row.groupLabel || row.group)}</strong><br /><small>{safeText(row.key)}</small></td>
                <td>{row.sends || 0}</td>
                <td>{row.replies || 0}</td>
                <td>{pct(row.responseRate)}</td>
                <td className="copy-cell">{shortBody(row.body, 160)}</td>
                <td><button type="button" onClick={() => setSelectedKey(`${row.group}:${row.key}`)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!templates.length ? <Empty>No templates loaded.</Empty> : null}
      </Panel>

      <div className="split-grid">
        <Panel title={selected ? `Edit live: ${safeText(selected.groupLabel)} / ${safeText(selected.key)}` : "Edit live"}>
          {selected ? (
            <div className="experiment-editor">
              <label>
                <span>Live copy</span>
                <textarea value={liveBody} onChange={(event) => setLiveBody(event.target.value)} />
              </label>
              <button className="primary" type="button" disabled={pushLive.isPending} onClick={() => pushLive.mutate()}>
                Push live and log change
              </button>
            </div>
          ) : <Empty>Select a script.</Empty>}
        </Panel>

        <Panel title="Create A/B test" subtitle="Control versus one variant. Winning variant is pushed explicitly.">
          {selected ? (
            <div className="experiment-editor">
              <label>
                <span>Control</span>
                <textarea value={selected.body || ""} readOnly />
              </label>
              <label>
                <span>Variant name</span>
                <input value={variantName} onChange={(event) => setVariantName(event.target.value)} />
              </label>
              <label>
                <span>Variant copy</span>
                <textarea value={variantBody} onChange={(event) => setVariantBody(event.target.value)} />
              </label>
              <button className="primary" type="button" disabled={saveExperiment.isPending} onClick={() => saveExperiment.mutate()}>
                Save active 50/50 test
              </button>
            </div>
          ) : <Empty>Select a script.</Empty>}
        </Panel>
      </div>

      <Panel title="Active experiments">
        <table className="data-table">
          <thead><tr><th>Experiment</th><th>Status</th><th>Variant</th><th>Sends</th><th>Replies</th><th>Rate</th><th>Action</th></tr></thead>
          <tbody>
            {experiments.flatMap((exp: any) => (exp.variants || []).map((variant: any) => (
              <tr key={`${exp.id}-${variant.id}`}>
                <td>{safeText(exp.name || exp.id)}</td>
                <td>{safeText(exp.status)}</td>
                <td>{safeText(variant.name || variant.id)}</td>
                <td>{variant.sends || 0}</td>
                <td>{variant.replies || 0}</td>
                <td>{pct(variant.responseRate)}</td>
                <td><button type="button" disabled={pushWinner.isPending} onClick={() => pushWinner.mutate({ experimentId: exp.id, variantId: variant.id })}>Push winner live</button></td>
              </tr>
            )))}
          </tbody>
        </table>
        {!experiments.length ? <Empty>No experiments yet.</Empty> : null}
      </Panel>
    </section>
  );
}

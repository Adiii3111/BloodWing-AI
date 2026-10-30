import { useSyncExternalStore } from 'react';
import { DEFAULT_LAB, runLab, type LabParams, type LabResult } from '../engine/experiment';

const KEY = 'bloodwing:lab:v1';

function loadParams(): LabParams {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_LAB, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_LAB;
}

let params: LabParams = loadParams();
let result: LabResult | null = null;
let running = false;
let progress = 0;
let v = 0;
const ls = new Set<() => void>();
const emit = () => {
  v++;
  ls.forEach((l) => l());
};

export const lab = {
  get params() {
    return params;
  },
  get result() {
    return result;
  },
  get running() {
    return running;
  },
  get progress() {
    return progress;
  },
  set(p: Partial<LabParams>) {
    params = { ...params, ...p };
    try {
      localStorage.setItem(KEY, JSON.stringify(params));
    } catch {
      /* ignore */
    }
    emit();
  },
  reset() {
    this.set(DEFAULT_LAB);
  },
  async run() {
    if (running) return;
    running = true;
    progress = 0;
    emit();
    try {
      result = await runLab(params, (d, t) => {
        progress = d / t;
        emit();
      });
    } finally {
      running = false;
      emit();
    }
  },
};

export function useLab() {
  useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => v,
  );
  return lab;
}

const STORAGE_KEY = 'apothecary-weighing-v1';

export interface SaveData {
  highestScore: number;
  highestLevel: number;
  lastPlayed: number;
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as SaveData;
      return {
        highestScore: data.highestScore ?? 0,
        highestLevel: data.highestLevel ?? 0,
        lastPlayed: data.lastPlayed ?? 0,
      };
    }
  } catch {
    // ignore parse error
  }
  return { highestScore: 0, highestLevel: 0, lastPlayed: 0 };
}

export function saveSave(data: SaveData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore storage error
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

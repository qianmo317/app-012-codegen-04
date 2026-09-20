import { ApothecaryGame } from './game';
import { loadSave, saveSave } from './storage';
import { SchedulerPanel } from './scheduler-ui';

const game = new ApothecaryGame('game-canvas');
game.start();

// 代煎排期面板入口
const schedulerPanel = new SchedulerPanel();
const schedulerBtn = document.createElement('button');
schedulerBtn.id = 'scheduler-toggle';
schedulerBtn.textContent = '📅 代煎排期';
schedulerBtn.addEventListener('click', () => schedulerPanel.toggle());
document.body.appendChild(schedulerBtn);

window.addEventListener('beforeunload', () => {
  const save = loadSave();
  const currentScore = (game.game?.state?.score) ?? 0;
  const currentLevel = (game.game?.state?.level) ?? 0;
  saveSave({
    highestScore: Math.max(save.highestScore, currentScore),
    highestLevel: Math.max(save.highestLevel, currentLevel),
    lastPlayed: Date.now(),
  });
});

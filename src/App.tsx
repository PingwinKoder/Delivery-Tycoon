import React, { useCallback, useEffect, useRef, useState } from 'react';
import { INITIAL_ROAD_GRAPH } from './data/initialRoadGraph';
import { MapCanvas, type MapCanvasController } from './components/MapCanvas';
import { OrdersModal } from './components/OrdersModal';
import { Toolbar } from './components/Toolbar';
import { PROCEDURAL_BUILDINGS } from './utils/buildings';
import {
  type GameSpeed,
  INITIAL_BALANCE,
  INITIAL_GAME_MINUTES,
} from './utils/gameClock';

const MAX_CLOCK_REAL_DT = 0.1;

export function App() {
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [footprintOnly, setFootprintOnly] = useState<boolean>(false);
  const [showStreetNames, setShowStreetNames] = useState<boolean>(true);
  const [balance] = useState<number>(INITIAL_BALANCE);
  const [gameMinutes, setGameMinutes] = useState<number>(INITIAL_GAME_MINUTES);
  const [gameSpeed, setGameSpeed] = useState<GameSpeed>(1);
  const [ordersOpen, setOrdersOpen] = useState<boolean>(false);

  const canvasControllerRef = useRef<MapCanvasController | null>(null);
  const exactGameMinutesRef = useRef<number>(INITIAL_GAME_MINUTES);

  // Advance world clock smoothly: at 1x, 1 real second = 1 in-game minute (2x = 2/s, 4x = 4/s, 0 = paused)
  useEffect(() => {
    if (gameSpeed === 0) return;

    let rafId: number | null = null;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const realDt = Math.min(Math.max(0, (now - lastTime) / 1000), MAX_CLOCK_REAL_DT);
      lastTime = now;

      const prevWhole = Math.floor(exactGameMinutesRef.current);
      exactGameMinutesRef.current += realDt * gameSpeed;
      const nextWhole = Math.floor(exactGameMinutesRef.current);

      if (nextWhole !== prevWhole) {
        setGameMinutes(nextWhole);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [gameSpeed]);

  const handleToggleGrid = useCallback(() => {
    setShowGrid((prev) => !prev);
  }, []);

  const handleToggleFootprintOnly = useCallback(() => {
    setFootprintOnly((prev) => !prev);
  }, []);

  const handleToggleStreetNames = useCallback(() => {
    setShowStreetNames((prev) => !prev);
  }, []);

  const handleChangeGameSpeed = useCallback((speed: GameSpeed) => {
    setGameSpeed(speed);
  }, []);

  const handleOpenOrders = useCallback(() => {
    setOrdersOpen(true);
  }, []);

  const handleCloseOrders = useCallback(() => {
    setOrdersOpen(false);
  }, []);

  return (
    <main className="relative w-full h-full overflow-hidden">
      <MapCanvas
        graph={INITIAL_ROAD_GRAPH}
        buildings={PROCEDURAL_BUILDINGS}
        showGrid={showGrid}
        footprintOnly={footprintOnly}
        showStreetNames={showStreetNames}
        gameSpeed={gameSpeed}
        interactionBlocked={ordersOpen}
        controllerRef={canvasControllerRef}
      />

      <Toolbar
        showGrid={showGrid}
        footprintOnly={footprintOnly}
        showStreetNames={showStreetNames}
        balance={balance}
        gameMinutes={gameMinutes}
        gameSpeed={gameSpeed}
        ordersOpen={ordersOpen}
        onToggleGrid={handleToggleGrid}
        onToggleFootprintOnly={handleToggleFootprintOnly}
        onToggleStreetNames={handleToggleStreetNames}
        onChangeGameSpeed={handleChangeGameSpeed}
        onOpenOrders={handleOpenOrders}
      />

      <OrdersModal isOpen={ordersOpen} onClose={handleCloseOrders} />
    </main>
  );
}

export default App;

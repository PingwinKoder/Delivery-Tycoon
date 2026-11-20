import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  INITIAL_ROAD_GRAPH,
  MAP_HEIGHT,
  MAP_WIDTH,
} from './data/initialRoadGraph';
import { BuildingInspector } from './components/BuildingInspector';
import { MapCanvas, type MapCanvasController } from './components/MapCanvas';
import { Toolbar } from './components/Toolbar';
import { ZoomControls } from './components/ZoomControls';
import {
  BUILDING_TYPE_META,
  type Building,
  formatBuildingAddress,
} from './types/building';
import type { EditorTool, RoadGraph } from './types/roadGraph';
import { PROCEDURAL_BUILDINGS } from './utils/buildings';
import { DEFAULT_ZOOM } from './utils/camera';
import {
  addNode,
  deleteNode,
  moveNode,
  serializeGraphToJson,
  toggleEdge,
} from './utils/graphEditor';

export function App() {
  const [graph, setGraph] = useState<RoadGraph>(INITIAL_ROAD_GRAPH);
  const [editMode, setEditMode] = useState<boolean>(false);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [footprintOnly, setFootprintOnly] = useState<boolean>(false);
  const [showStreetNames, setShowStreetNames] = useState<boolean>(true);
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [activeTool, setActiveTool] = useState<EditorTool>('move');
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);
  const [copied, setCopied] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Kliknij budynek (inspektor) lub ulicę (wyślij kuriera z Bazy)'
  );

  const canvasControllerRef = useRef<MapCanvasController | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    document.body.dataset.state = editMode ? 'editing' : 'playing';
  }, [editMode]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedBuilding(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleToggleEditMode = useCallback(() => {
    setEditMode((prev) => {
      const next = !prev;
      setConnectSourceId(null);
      if (next) {
        setShowGrid(true);
        setSelectedBuilding(null);
        setStatusMessage('Edycja: przeciągnij węzeł (Shift+klik dodaje)');
      } else {
        setStatusMessage('Kliknij budynek (inspektor) lub ulicę (wyślij kuriera z Bazy)');
      }
      return next;
    });
  }, []);

  const handleToggleGrid = useCallback(() => {
    setShowGrid((prev) => !prev);
  }, []);

  const handleToggleFootprintOnly = useCallback(() => {
    setFootprintOnly((prev) => {
      const next = !prev;
      setStatusMessage(
        next
          ? 'Widok: tylko podstawy budynków (2D) — siatka dróg w pełni odsłonięta'
          : 'Widok: bryły budynków 3D'
      );
      return next;
    });
  }, []);

  const handleToggleStreetNames = useCallback(() => {
    setShowStreetNames((prev) => {
      const next = !prev;
      setStatusMessage(next ? 'Nazwy ulic włączone' : 'Nazwy ulic ukryte');
      return next;
    });
  }, []);

  const handleSelectBuilding = useCallback((building: Building | null) => {
    setSelectedBuilding(building);
    if (building) {
      const meta = BUILDING_TYPE_META[building.typ];
      setStatusMessage(`${meta.label} — ${formatBuildingAddress(building)}`);
    }
  }, []);

  const handleSelectTool = useCallback((tool: EditorTool) => {
    setActiveTool(tool);
    setConnectSourceId(null);
    const hints: Record<EditorTool, string> = {
      move: 'Chwyć i przeciągnij dowolny węzeł, aby wyrównać go do skrzyżowania',
      add: 'Kliknij na mapę, aby dodać nowy węzeł',
      connect: 'Kliknij pierwszy węzeł, a następnie drugi, aby połączyć lub rozłączyć',
      delete: 'Kliknij węzeł, aby go usunąć (Baza jest chroniona)',
    };
    setStatusMessage(hints[tool]);
  }, []);

  const handleMoveNode = useCallback((nodeId: string, x: number, y: number) => {
    setGraph((prev) => moveNode(prev, nodeId, x, y, MAP_WIDTH, MAP_HEIGHT));
  }, []);

  const handleAddNode = useCallback((x: number, y: number) => {
    setGraph((prev) => addNode(prev, x, y, MAP_WIDTH, MAP_HEIGHT).graph);
  }, []);

  const handleToggleEdge = useCallback((aId: string, bId: string) => {
    setGraph((prev) => {
      const res = toggleEdge(prev, aId, bId);
      if (res.action === 'added') {
        setStatusMessage(`Połączono ${aId} ↔ ${bId}`);
      } else if (res.action === 'removed') {
        setStatusMessage(`Rozłączono ${aId} — ${bId}`);
      }
      return res.graph;
    });
  }, []);

  const handleDeleteNode = useCallback((nodeId: string) => {
    setGraph((prev) => {
      const res = deleteNode(prev, nodeId);
      if (!res.deleted) {
        if (res.reason === 'protected_base') {
          setStatusMessage('Nie można usunąć Bazy — możesz ją przesunąć');
        }
        return prev;
      }
      setStatusMessage(`Usunięto węzeł ${nodeId}`);
      return res.graph;
    });
  }, []);

  const handleCopyJson = useCallback(async () => {
    const json = serializeGraphToJson(graph);
    let success = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(json);
        success = true;
      }
    } catch {
      success = false;
    }

    if (!success) {
      const ta = document.createElement('textarea');
      ta.value = json;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        success = document.execCommand('copy');
      } catch {
        success = false;
      }
      document.body.removeChild(ta);
    }

    if (success) {
      setCopied(true);
      setStatusMessage(
        `Skopiowano JSON (${graph.nodes.length} węzłów, ${graph.edges.length} połączeń)`
      );
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } else {
      setStatusMessage('Nie udało się skopiować automatycznie — sprawdź uprawnienia schowka');
    }
  }, [graph]);

  return (
    <main className="relative w-full h-full overflow-hidden">
      <MapCanvas
        graph={graph}
        buildings={PROCEDURAL_BUILDINGS}
        editMode={editMode}
        showGrid={showGrid}
        footprintOnly={footprintOnly}
        showStreetNames={showStreetNames}
        selectedBuildingId={selectedBuilding?.id ?? null}
        activeTool={activeTool}
        connectSourceId={connectSourceId}
        onZoomChange={setZoom}
        onSelectBuilding={handleSelectBuilding}
        onSelectConnectSource={setConnectSourceId}
        onMoveNode={handleMoveNode}
        onAddNode={handleAddNode}
        onToggleEdge={handleToggleEdge}
        onDeleteNode={handleDeleteNode}
        onStatusMessage={setStatusMessage}
        controllerRef={canvasControllerRef}
      />

      <Toolbar
        editMode={editMode}
        showGrid={showGrid}
        footprintOnly={footprintOnly}
        showStreetNames={showStreetNames}
        activeTool={activeTool}
        copied={copied}
        nodeCount={graph.nodes.length}
        edgeCount={graph.edges.length}
        buildingCount={PROCEDURAL_BUILDINGS.length}
        onToggleEditMode={handleToggleEditMode}
        onToggleGrid={handleToggleGrid}
        onToggleFootprintOnly={handleToggleFootprintOnly}
        onToggleStreetNames={handleToggleStreetNames}
        onSelectTool={handleSelectTool}
        onCopyJson={handleCopyJson}
      />

      {!editMode && selectedBuilding && (
        <BuildingInspector
          building={selectedBuilding}
          onClose={() => setSelectedBuilding(null)}
          onDispatchCourier={(building) =>
            canvasControllerRef.current?.dispatchCourierToBuilding(building)
          }
        />
      )}

      <ZoomControls
        zoom={zoom}
        onZoomIn={() => canvasControllerRef.current?.zoomByDelta(0.2)}
        onZoomOut={() => canvasControllerRef.current?.zoomByDelta(-0.2)}
        onCenterBase={() => canvasControllerRef.current?.centerOnBase()}
      />

      {/* Compact bottom-left status bar */}
      <div
        className="pointer-events-none fixed bottom-4 left-4 right-20 sm:right-auto sm:max-w-md z-20 px-3 py-2 rounded-lg border border-white/12 text-xs text-slate-200 font-medium truncate shadow-md"
        style={{ backgroundColor: 'rgba(15, 23, 42, 0.85)' }}
        role="status"
        aria-live="polite"
      >
        {statusMessage}
      </div>
    </main>
  );
}

export default App;

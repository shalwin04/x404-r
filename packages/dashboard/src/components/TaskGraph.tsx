'use client';

import React, { useCallback, useMemo } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  NodeProps,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { TaskNode as TaskNodeType, statusColors, statusLabels } from '@/lib/types';

interface TaskGraphProps {
  tasks: TaskNodeType[];
  onTaskClick?: (task: TaskNodeType) => void;
  onKillWorker?: (taskId: string) => void;
}

// Custom node component for tasks
function TaskNodeComponent({ data }: NodeProps<{ task: TaskNodeType; onClick?: () => void; onKill?: () => void }>) {
  const { task, onClick, onKill } = data;
  const colors = statusColors[task.status];
  const isRunning = task.status === 'running' || task.status === 'claimed';

  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 ${colors.bg} ${colors.border} min-w-[180px] cursor-pointer transition-all hover:scale-105`}
      onClick={onClick}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />

      <div className="flex items-center justify-between gap-2 mb-2">
        <span className={`text-xs font-semibold uppercase ${colors.text}`}>
          {statusLabels[task.status]}
        </span>
        {isRunning && (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
          </span>
        )}
      </div>

      <div className="font-medium text-white text-sm truncate" title={task.name}>
        {task.name}
      </div>

      <div className="text-xs text-gray-400 mt-1">
        {task.task_type}
      </div>

      {task.claimed_by && (
        <div className="text-xs text-gray-500 mt-1 truncate">
          Worker: {task.claimed_by.slice(0, 12)}...
        </div>
      )}

      {task.attempt_count > 0 && (
        <div className="text-xs text-gray-500 mt-1">
          Attempts: {task.attempt_count}/{task.max_attempts}
        </div>
      )}

      {isRunning && onKill && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onKill();
          }}
          className="mt-2 w-full px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
        >
          Kill Worker
        </button>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />
    </div>
  );
}

const nodeTypes = {
  task: TaskNodeComponent,
};

export default function TaskGraph({ tasks, onTaskClick, onKillWorker }: TaskGraphProps) {
  // Convert tasks to React Flow nodes with dagre-style layout
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodeMap = new Map<string, TaskNodeType>();
    tasks.forEach(t => nodeMap.set(t.id, t));

    // Build dependency graph
    const dependents = new Map<string, string[]>();
    tasks.forEach(task => {
      task.depends_on.forEach(depId => {
        const list = dependents.get(depId) || [];
        list.push(task.id);
        dependents.set(depId, list);
      });
    });

    // Calculate levels using BFS
    const levels = new Map<string, number>();
    const roots = tasks.filter(t => t.depends_on.length === 0);
    const queue: Array<{ id: string; level: number }> = roots.map(t => ({ id: t.id, level: 0 }));

    while (queue.length > 0) {
      const { id, level } = queue.shift()!;
      const currentLevel = levels.get(id);
      if (currentLevel !== undefined && currentLevel >= level) continue;

      levels.set(id, level);

      const deps = dependents.get(id) || [];
      deps.forEach(depId => {
        queue.push({ id: depId, level: level + 1 });
      });
    }

    // Group tasks by level
    const levelGroups = new Map<number, string[]>();
    levels.forEach((level, id) => {
      const group = levelGroups.get(level) || [];
      group.push(id);
      levelGroups.set(level, group);
    });

    // Create nodes with positions
    const nodes: Node[] = [];
    const xSpacing = 250;
    const ySpacing = 150;

    levelGroups.forEach((taskIds, level) => {
      const startX = -(taskIds.length - 1) * xSpacing / 2;

      taskIds.forEach((taskId, index) => {
        const task = nodeMap.get(taskId)!;
        nodes.push({
          id: task.id,
          type: 'task',
          position: { x: startX + index * xSpacing, y: level * ySpacing },
          data: {
            task,
            onClick: () => onTaskClick?.(task),
            onKill: () => onKillWorker?.(task.id),
          },
        });
      });
    });

    // Create edges
    const edges: Edge[] = [];
    tasks.forEach(task => {
      task.depends_on.forEach(depId => {
        edges.push({
          id: `${depId}-${task.id}`,
          source: depId,
          target: task.id,
          animated: nodeMap.get(depId)?.status === 'running',
          style: { stroke: '#6b7280', strokeWidth: 2 },
        });
      });
    });

    return { nodes, edges };
  }, [tasks, onTaskClick, onKillWorker]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes when tasks change
  React.useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  return (
    <div className="w-full h-full bg-gray-800 rounded-lg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        className="bg-gray-800"
      >
        <Controls className="!bg-gray-700 !border-gray-600" />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#374151" />
      </ReactFlow>
    </div>
  );
}

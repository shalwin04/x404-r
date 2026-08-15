'use client';

import React, { useMemo } from 'react';
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
import { TaskNode as TaskNodeType } from '@/lib/types';

interface TaskGraphProps {
  tasks: TaskNodeType[];
  onTaskClick?: (task: TaskNodeType) => void;
  onKillWorker?: (taskId: string) => void;
}

const statusConfig: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  pending: {
    bg: 'rgba(113, 113, 122, 0.1)',
    border: 'rgba(113, 113, 122, 0.3)',
    text: '#a1a1aa',
    dot: '#71717a',
  },
  claimed: {
    bg: 'rgba(59, 130, 246, 0.1)',
    border: 'rgba(59, 130, 246, 0.3)',
    text: '#60a5fa',
    dot: '#3b82f6',
  },
  running: {
    bg: 'rgba(59, 130, 246, 0.1)',
    border: 'rgba(59, 130, 246, 0.3)',
    text: '#60a5fa',
    dot: '#3b82f6',
  },
  done: {
    bg: 'rgba(34, 197, 94, 0.1)',
    border: 'rgba(34, 197, 94, 0.3)',
    text: '#4ade80',
    dot: '#22c55e',
  },
  failed: {
    bg: 'rgba(239, 68, 68, 0.1)',
    border: 'rgba(239, 68, 68, 0.3)',
    text: '#f87171',
    dot: '#ef4444',
  },
};

function TaskNodeComponent({ data }: NodeProps<{ task: TaskNodeType; onClick?: () => void; onKill?: () => void }>) {
  const { task, onClick, onKill } = data;
  const config = statusConfig[task.status] || statusConfig.pending;
  const isRunning = task.status === 'running' || task.status === 'claimed';

  return (
    <div
      onClick={onClick}
      style={{
        background: config.bg,
        border: `1px solid ${config.border}`,
        borderRadius: '12px',
        padding: '14px 18px',
        minWidth: '180px',
        cursor: 'pointer',
        transition: 'transform 160ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 160ms cubic-bezier(0.23, 1, 0.32, 1)',
        boxShadow: '0 2px 8px -2px rgba(0, 0, 0, 0.3)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'scale(1.02) translateY(-1px)';
        e.currentTarget.style.boxShadow = '0 8px 24px -8px rgba(0, 0, 0, 0.4)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1) translateY(0)';
        e.currentTarget.style.boxShadow = '0 2px 8px -2px rgba(0, 0, 0, 0.3)';
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#3f3f46', border: 'none', width: 6, height: 6 }}
      />

      {/* Status Row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: config.dot,
              animation: isRunning ? 'pulse-glow 2s infinite' : 'none',
            }}
          />
          <span style={{ fontSize: '10px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', color: config.text }}>
            {task.status}
          </span>
        </div>
        {task.attempt_count > 0 && (
          <span style={{ fontSize: '10px', color: '#71717a', fontFamily: 'var(--font-mono)' }}>
            {task.attempt_count}/{task.max_attempts}
          </span>
        )}
      </div>

      {/* Task Name */}
      <div style={{ fontSize: '13px', fontWeight: 500, color: '#fafafa', marginBottom: '4px' }}>
        {task.name}
      </div>

      {/* Task Type */}
      <div style={{ fontSize: '11px', color: '#71717a', fontFamily: 'var(--font-mono)' }}>
        {task.task_type}
      </div>

      {/* Worker */}
      {task.claimed_by && (
        <div style={{ fontSize: '10px', color: '#52525b', marginTop: '6px', fontFamily: 'var(--font-mono)' }}>
          {task.claimed_by.slice(0, 16)}
        </div>
      )}

      {/* Kill Button */}
      {isRunning && onKill && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onKill();
          }}
          style={{
            marginTop: '8px',
            width: '100%',
            padding: '4px 8px',
            fontSize: '10px',
            fontWeight: 500,
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '4px',
            color: '#f87171',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          className="hover:bg-red-500/20"
        >
          Simulate Crash
        </button>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: '#3f3f46', border: 'none', width: 6, height: 6 }}
      />
    </div>
  );
}

const nodeTypes = {
  task: TaskNodeComponent,
};

export default function TaskGraph({ tasks, onTaskClick, onKillWorker }: TaskGraphProps) {
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
      deps.forEach(depId => queue.push({ id: depId, level: level + 1 }));
    }

    // Group by level
    const levelGroups = new Map<number, string[]>();
    levels.forEach((level, id) => {
      const group = levelGroups.get(level) || [];
      group.push(id);
      levelGroups.set(level, group);
    });

    // Create nodes
    const nodes: Node[] = [];
    const xSpacing = 220;
    const ySpacing = 120;

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
    const edges: Edge[] = tasks.flatMap(task =>
      task.depends_on.map(depId => ({
        id: `${depId}-${task.id}`,
        source: depId,
        target: task.id,
        animated: nodeMap.get(depId)?.status === 'running' || nodeMap.get(depId)?.status === 'claimed',
        style: {
          stroke: nodeMap.get(depId)?.status === 'done' ? '#22c55e' : '#3f3f46',
          strokeWidth: 1.5,
          strokeDasharray: nodeMap.get(depId)?.status === 'done' ? 'none' : '4 2',
        },
      }))
    );

    return { nodes, edges };
  }, [tasks, onTaskClick, onKillWorker]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  React.useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        style={{ background: '#18181b' }}
      >
        <Controls
          showInteractive={false}
          position="bottom-right"
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="#27272a"
        />
      </ReactFlow>
    </div>
  );
}

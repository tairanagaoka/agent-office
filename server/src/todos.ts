import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const TODOS_FILE = join(DATA_DIR, "todos.json");

export type Todo = {
  id: string;
  text: string;
  done: boolean;
  agentId?: string;
  status?: "running" | "completed" | "failed";
  googleTaskId?: string;
  parentId?: string; // 親Todoのローカルid(サブタスクの場合のみ)
  due?: string; // "YYYY-MM-DD"
};

function readTodos(): Todo[] {
  if (!existsSync(TODOS_FILE)) return [];
  return JSON.parse(readFileSync(TODOS_FILE, "utf-8"));
}

function writeTodos(todos: Todo[]): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(TODOS_FILE, JSON.stringify(todos, null, 2));
}

export function listTodos(): Todo[] {
  return readTodos();
}

export function addTodo(text: string, opts?: { due?: string; parentId?: string }): Todo {
  const todos = readTodos();
  const todo: Todo = { id: randomUUID(), text, done: false, ...opts };
  todos.push(todo);
  writeTodos(todos);
  return todo;
}

export function updateTodo(id: string, patch: Partial<Todo>): Todo | undefined {
  const todos = readTodos();
  const todo = todos.find((t) => t.id === id);
  if (!todo) return undefined;
  Object.assign(todo, patch);
  writeTodos(todos);
  return todo;
}

export function deleteTodo(id: string): void {
  writeTodos(readTodos().filter((t) => t.id !== id));
}

// Google Tasksから一括で取り込む。既にgoogleTaskIdがあるものはスキップ(再同期での重複防止)。
// サブタスクの親子関係(Google側のparent id)をローカルのparentIdに変換して維持する。
export function syncFromGoogle(
  tasks: { id: string; title: string; due?: string; parent?: string }[]
): number {
  const todos = readTodos();
  const googleIdToLocalId = new Map(
    todos.filter((t) => t.googleTaskId).map((t) => [t.googleTaskId as string, t.id])
  );

  const newTodos: Todo[] = [];
  for (const task of tasks) {
    if (googleIdToLocalId.has(task.id)) continue;
    const todo: Todo = { id: randomUUID(), text: task.title, done: false, googleTaskId: task.id, due: task.due };
    newTodos.push(todo);
    googleIdToLocalId.set(task.id, todo.id);
  }
  // 親子付けは全件登録した後に解決する(親が今回のバッチで初めて登場するケースがあるため)
  for (const todo of newTodos) {
    const task = tasks.find((t) => t.id === todo.googleTaskId);
    if (task?.parent) {
      todo.parentId = googleIdToLocalId.get(task.parent);
    }
  }

  if (newTodos.length > 0) {
    writeTodos([...todos, ...newTodos]);
  }
  return newTodos.length;
}

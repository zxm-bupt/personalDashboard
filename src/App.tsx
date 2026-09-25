import { useState } from 'react'
import { Layout } from './components/Layout'
import { TaskForm } from './components/TaskForm'
import { usePomodoro } from './hooks/usePomodoro'
import { useTray } from './hooks/useTray'
import { useWorkbench } from './hooks/useWorkbench'
import { DashboardPage } from './pages/DashboardPage'
import { TasksPage } from './pages/TasksPage'
import { TimePage } from './pages/TimePage'
import type { AppSection, Task, TaskInput } from './types'

function App() {
  const {
    state,
    activeTimer,
    createTask,
    updateTask,
    deleteTask,
    toggleTaskDone,
    startTask,
    stopTimer,
    clockIn,
    clockOut,
    addFocusSession,
    openTaskResource,
    openAllTaskResources,
    exportData,
    deleteTimeEntry,
    deleteCheckin,
    clearTasks,
    clearTimeEntries,
    clearCheckins,
    clearAll,
  } = useWorkbench()

  const pomodoro = usePomodoro({
    hasOtherFocus: Boolean(activeTimer),
    onCompleteFocus: addFocusSession,
    onStopOtherFocus: stopTimer,
  })

  useTray({ checkins: state.checkins, pomodoro, onClockIn: clockIn, onClockOut: clockOut })

  const [section, setSection] = useState<AppSection>('dashboard')
  const [formOpen, setFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)

  const openNewTask = () => {
    setEditingTask(null)
    setFormOpen(true)
  }

  const openEditTask = (task: Task) => {
    setEditingTask(task)
    setFormOpen(true)
  }

  const handleSubmit = (input: TaskInput) => {
    if (editingTask) {
      updateTask(editingTask.id, input)
    } else {
      createTask(input)
    }
    setFormOpen(false)
    setEditingTask(null)
  }

  const handleDeleteTask = (task: Task) => {
    deleteTask(task.id)
    if (editingTask?.id === task.id) {
      setEditingTask(null)
      setFormOpen(false)
    }
  }

  return (
    <>
      <Layout
        section={section}
        onSectionChange={setSection}
        onExport={exportData}
        onClear={clearAll}
      >
        {section === 'dashboard' && (
          <DashboardPage
            tasks={state.tasks}
            timeEntries={state.timeEntries}
            checkins={state.checkins}
            onToggleDone={toggleTaskDone}
            onEditTask={openEditTask}
            onDeleteTask={handleDeleteTask}
            onOpenResource={openTaskResource}
            onOpenAllResources={openAllTaskResources}
            onNewTask={openNewTask}
          />
        )}

        {section === 'tasks' && (
          <TasksPage
            tasks={state.tasks}
            activeTimerTaskId={activeTimer?.taskId ?? null}
            onStartTask={startTask}
            onClearTasks={clearTasks}
            onToggleDone={toggleTaskDone}
            onEditTask={openEditTask}
            onDeleteTask={handleDeleteTask}
            onOpenResource={openTaskResource}
            onOpenAllResources={openAllTaskResources}
            onNewTask={openNewTask}
          />
        )}

        <div className={section === 'time' ? undefined : 'section-hidden'}>
          <TimePage
            tasks={state.tasks}
            timeEntries={state.timeEntries}
            checkins={state.checkins}
            activeTimer={activeTimer}
            pomodoro={pomodoro}
            onClockIn={clockIn}
            onClockOut={clockOut}
            onStopTimer={stopTimer}
            onDeleteTimeEntry={deleteTimeEntry}
            onDeleteCheckin={deleteCheckin}
            onClearTimeEntries={clearTimeEntries}
            onClearCheckins={clearCheckins}
          />
        </div>
      </Layout>

      <TaskForm
        key={formOpen ? (editingTask?.id ?? 'new') : 'closed'}
        open={formOpen}
        task={editingTask}
        onClose={() => {
          setFormOpen(false)
          setEditingTask(null)
        }}
        onSubmit={handleSubmit}
      />
    </>
  )
}

export default App

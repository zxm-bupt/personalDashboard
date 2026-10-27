import { useState } from 'react'
import { CheckinForm } from './components/CheckinForm'
import type { CheckinFormValue } from './components/CheckinForm'
import { Layout } from './components/Layout'
import { PomodoroAlert } from './components/PomodoroAlert'
import { TaskForm } from './components/TaskForm'
import { describePhaseComplete, usePomodoro } from './hooks/usePomodoro'
import type { PomodoroPhaseCompleteEvent } from './hooks/usePomodoro'
import { raisePomodoroAlert } from './lib/alert'
import { useTray } from './hooks/useTray'
import { useWorkbench } from './hooks/useWorkbench'
import { DashboardPage } from './pages/DashboardPage'
import { TasksPage } from './pages/TasksPage'
import { TimePage } from './pages/TimePage'
import type { AppSection, Checkin, Task, TaskInput } from './types'

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
    addCheckin,
    updateCheckin,
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

  const [pomodoroAlert, setPomodoroAlert] = useState<PomodoroPhaseCompleteEvent | null>(null)

  const handlePhaseComplete = (event: PomodoroPhaseCompleteEvent) => {
    setPomodoroAlert(event)
    const { title, body } = describePhaseComplete(event)
    void raisePomodoroAlert(title, body).catch((error) => {
      console.error('番茄钟提醒失败', error)
    })
  }

  const pomodoro = usePomodoro({
    hasOtherFocus: Boolean(activeTimer),
    onCompleteFocus: addFocusSession,
    onStopOtherFocus: stopTimer,
    onPhaseComplete: handlePhaseComplete,
  })

  useTray({ checkins: state.checkins, pomodoro, onClockIn: clockIn, onClockOut: clockOut })

  const [section, setSection] = useState<AppSection>('dashboard')
  const [formOpen, setFormOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [checkinFormOpen, setCheckinFormOpen] = useState(false)
  const [editingCheckin, setEditingCheckin] = useState<Checkin | null>(null)

  const openNewCheckin = () => {
    setEditingCheckin(null)
    setCheckinFormOpen(true)
  }

  const openEditCheckin = (checkin: Checkin) => {
    setEditingCheckin(checkin)
    setCheckinFormOpen(true)
  }

  const closeCheckinForm = () => {
    setCheckinFormOpen(false)
    setEditingCheckin(null)
  }

  const handleCheckinSubmit = (value: CheckinFormValue) => {
    if (editingCheckin) {
      updateCheckin(editingCheckin.id, value)
    } else {
      addCheckin(value)
    }
    closeCheckinForm()
  }

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
            onNewCheckin={openNewCheckin}
            onEditCheckin={openEditCheckin}
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

      <CheckinForm
        key={checkinFormOpen ? (editingCheckin?.id ?? 'new') : 'closed'}
        open={checkinFormOpen}
        checkin={editingCheckin}
        checkins={state.checkins}
        onClose={closeCheckinForm}
        onSubmit={handleCheckinSubmit}
      />

      {pomodoroAlert && (
        <PomodoroAlert
          {...describePhaseComplete(pomodoroAlert)}
          onStartNext={() => {
            setPomodoroAlert(null)
            // 番茄钟已经切到下一阶段并重置好时长，这里直接开始
            if (!pomodoro.running) pomodoro.toggleTimer()
          }}
          onDismiss={() => setPomodoroAlert(null)}
        />
      )}
    </>
  )
}

export default App

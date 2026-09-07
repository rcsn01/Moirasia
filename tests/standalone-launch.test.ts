import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { runStandaloneLaunch, type StandaloneLaunchOptions } from '../packages/desktop-shell/src/standalone-launch'

/**
 * An EventEmitter-shaped electron double: every app/Menu/session method is a
 * vi.fn spy, whenReady resolves through a controllable deferred, and the
 * sibling login-item-control module is mocked to claim or refuse the process
 * on demand. Tests drive everything through runStandaloneLaunch and the
 * double's events, asserting observable outcomes only.
 */
const mocks = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  const listeners = new Map<string, Listener[]>()
  const on = vi.fn((event: string, listener: Listener) => { listeners.set(event, [...(listeners.get(event) ?? []), listener]) })
  const emit = (event: string, ...args: unknown[]) => { for (const listener of [...(listeners.get(event) ?? [])]) listener(...args) }
  const paths = new Map<string, string>()
  let resolveWhenReady: () => void = () => undefined
  let whenReadyPromise = new Promise<void>((resolve) => { resolveWhenReady = resolve })
  const app = {
    on,
    setName: vi.fn(),
    setAppUserModelId: vi.fn(),
    setPath: vi.fn((name: string, value: string) => { paths.set(name, value) }),
    getPath: vi.fn((name: string) => paths.get(name) ?? '/tmp/default-user-data'),
    requestSingleInstanceLock: vi.fn(() => true),
    whenReady: vi.fn(() => whenReadyPromise),
    quit: vi.fn(),
    exit: vi.fn()
  }
  const Menu = { buildFromTemplate: vi.fn((template: unknown[]) => ({ template })), setApplicationMenu: vi.fn() }
  const onHeadersReceived = vi.fn()
  const session = { defaultSession: { webRequest: { onHeadersReceived } } }
  const runLoginItemControl = vi.fn(async () => false)
  return {
    electron: { app, Menu, session },
    runLoginItemControl,
    onHeadersReceived,
    emit,
    reset(): void {
      listeners.clear()
      paths.clear()
      whenReadyPromise = new Promise<void>((resolve) => { resolveWhenReady = resolve })
      resolveWhenReady()
    }
  }
})

vi.mock('electron', () => mocks.electron)
vi.mock('../packages/desktop-shell/src/login-item-control', () => ({ runLoginItemControl: mocks.runLoginItemControl }))

const { app, Menu } = mocks.electron

let errorLog: MockInstance<typeof console.error>

beforeEach(() => {
  vi.clearAllMocks()
  mocks.reset()
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => { errorLog.mockRestore() })

function launchOptions(overrides: Pick<StandaloneLaunchOptions, 'register' | 'dispose'> & Partial<StandaloneLaunchOptions>): StandaloneLaunchOptions {
  return { appId: 'test', productName: 'Test', ...overrides }
}

describe('runStandaloneLaunch', () => {
  it('starts: identity is synchronous, control runs first, ready-time wiring precedes register', async () => {
    const previousUrl = process.env.ELECTRON_RENDERER_URL
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173'
    try {
      const register = vi.fn(async () => undefined)
      const outcome = runStandaloneLaunch(launchOptions({
        appId: 'amove-like',
        productName: 'Amove',
        appUserModelId: 'com.opense.Amove',
        contentSecurityPolicy: (rendererUrl) => `policy:${rendererUrl}`,
        menu: () => [{ label: 'App' }],
        register,
        dispose: () => undefined,
        activate: () => undefined
      }))
      await expect(outcome).resolves.toBe('started')

      expect(app.setName).toHaveBeenCalledWith('Amove')
      expect(app.setAppUserModelId).toHaveBeenCalledWith('com.opense.Amove')
      const setNameOrder = app.setName.mock.invocationCallOrder[0]!
      expect(setNameOrder).toBeLessThan(mocks.runLoginItemControl.mock.invocationCallOrder[0]!)
      expect(app.setAppUserModelId.mock.invocationCallOrder[0]!).toBeLessThan(mocks.runLoginItemControl.mock.invocationCallOrder[0]!)
      expect(setNameOrder).toBeLessThan(app.requestSingleInstanceLock.mock.invocationCallOrder[0]!)
      expect(mocks.runLoginItemControl).toHaveBeenCalledWith('amove-like')

      const [handler] = mocks.onHeadersReceived.mock.calls[0]!
      const callback = vi.fn()
      handler({ responseHeaders: { 'x-frame': ['sameorigin'] } }, callback)
      expect(callback).toHaveBeenCalledWith({ responseHeaders: { 'x-frame': ['sameorigin'], 'Content-Security-Policy': ['policy:http://localhost:5173'] } })

      expect(Menu.buildFromTemplate).toHaveBeenCalledWith([{ label: 'App' }])
      expect(Menu.setApplicationMenu).toHaveBeenCalledWith(Menu.buildFromTemplate.mock.results[0]!.value)
      expect(mocks.onHeadersReceived.mock.invocationCallOrder[0]!).toBeLessThan(Menu.setApplicationMenu.mock.invocationCallOrder[0]!)
      expect(Menu.setApplicationMenu.mock.invocationCallOrder[0]!).toBeLessThan(register.mock.invocationCallOrder[0]!)
      expect(register).toHaveBeenCalledTimes(1)
      expect(app.quit).not.toHaveBeenCalled()
      expect(app.exit).not.toHaveBeenCalled()
    } finally {
      if (previousUrl === undefined) delete process.env.ELECTRON_RENDERER_URL
      else process.env.ELECTRON_RENDERER_URL = previousUrl
    }
  })

  it('control mode: claims the process without registering a single listener', async () => {
    mocks.runLoginItemControl.mockResolvedValueOnce(true)
    const register = vi.fn()
    await expect(runStandaloneLaunch(launchOptions({ appId: 'orbis-like', productName: 'Orbis', register, dispose: () => undefined }))).resolves.toBe('controlled')
    expect(app.setName).toHaveBeenCalledWith('Orbis')
    expect(app.on).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
    expect(app.quit).not.toHaveBeenCalled()
    expect(app.exit).not.toHaveBeenCalled()
  })

  it('platform guard: exits before the lock when the platform is out of scope', async () => {
    const foreignPlatform = process.platform === 'darwin' ? 'win32' : 'darwin'
    await expect(runStandaloneLaunch(launchOptions({ platforms: [foreignPlatform], register: () => undefined, dispose: () => undefined }))).resolves.toBe('unsupported-platform')
    expect(app.exit).toHaveBeenCalledWith(1)
    expect(app.requestSingleInstanceLock).not.toHaveBeenCalled()
    expect(app.on).not.toHaveBeenCalled()
    expect(app.quit).not.toHaveBeenCalled()
  })

  it('arch guard: same contract for architecture', async () => {
    const foreignArch = process.arch === 'arm64' ? 'x64' : 'arm64'
    await expect(runStandaloneLaunch(launchOptions({ archs: [foreignArch], register: () => undefined, dispose: () => undefined }))).resolves.toBe('unsupported-platform')
    expect(app.exit).toHaveBeenCalledWith(1)
    expect(app.requestSingleInstanceLock).not.toHaveBeenCalled()
    expect(app.on).not.toHaveBeenCalled()
  })

  it('lock refused: quits without listeners', async () => {
    app.requestSingleInstanceLock.mockReturnValueOnce(false)
    const register = vi.fn()
    await expect(runStandaloneLaunch(launchOptions({ register, dispose: () => undefined }))).resolves.toBe('single-instance-refused')
    expect(app.quit).toHaveBeenCalledTimes(1)
    expect(app.on).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
    expect(app.exit).not.toHaveBeenCalled()
  })

  it('register rejection: logs, awaits the failure hook, then quits', async () => {
    let releaseHook!: () => void
    const hookGate = new Promise<void>((resolve) => { releaseHook = resolve })
    const failure = new Error('native helper missing')
    const onRegisterError = vi.fn(() => hookGate)
    const outcome = runStandaloneLaunch(launchOptions({ register: () => { throw failure }, dispose: () => undefined, onRegisterError }))
    await vi.waitFor(() => expect(onRegisterError).toHaveBeenCalled())
    expect(app.quit).not.toHaveBeenCalled()
    releaseHook()
    await expect(outcome).resolves.toBe('start-failed')
    expect(errorLog).toHaveBeenCalledWith(failure)
    expect(app.quit).toHaveBeenCalledTimes(1)
  })

  it('a rejecting failure hook is logged and the quit still proceeds', async () => {
    const failure = new Error('boom')
    const hookFailure = new Error('dialog failed')
    await expect(runStandaloneLaunch(launchOptions({ register: () => Promise.reject(failure), dispose: () => undefined, onRegisterError: () => { throw hookFailure } }))).resolves.toBe('start-failed')
    expect(errorLog).toHaveBeenCalledWith(failure)
    expect(errorLog).toHaveBeenCalledWith(hookFailure)
    expect(app.quit).toHaveBeenCalledTimes(1)
  })

  it('before-quit: preventDefault once, dispose awaited before the final quit, later pass-through', async () => {
    let releaseDispose!: () => void
    const disposeGate = new Promise<void>((resolve) => { releaseDispose = resolve })
    const dispose = vi.fn(() => disposeGate)
    await expect(runStandaloneLaunch(launchOptions({ register: () => undefined, dispose }))).resolves.toBe('started')

    const first = { preventDefault: vi.fn() }
    mocks.emit('before-quit', first)
    expect(first.preventDefault).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(app.quit).not.toHaveBeenCalled()

    const duringTeardown = { preventDefault: vi.fn() }
    mocks.emit('before-quit', duringTeardown)
    expect(duringTeardown.preventDefault).toHaveBeenCalledTimes(1)
    expect(dispose).toHaveBeenCalledTimes(1)

    releaseDispose()
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledTimes(1))
    expect(errorLog).not.toHaveBeenCalled()

    const afterTeardown = { preventDefault: vi.fn() }
    mocks.emit('before-quit', afterTeardown)
    expect(afterTeardown.preventDefault).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(app.quit).toHaveBeenCalledTimes(1)
  })

  it('before-quit waits for an in-flight registration before disposal', async () => {
    let releaseRegister!: () => void
    const registerGate = new Promise<void>((resolve) => { releaseRegister = resolve })
    const register = vi.fn(() => registerGate)
    const dispose = vi.fn()
    const outcome = runStandaloneLaunch(launchOptions({ register, dispose }))
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1))

    const event = { preventDefault: vi.fn() }
    mocks.emit('before-quit', event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(dispose).not.toHaveBeenCalled()

    releaseRegister()
    await expect(outcome).resolves.toBe('started')
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1))
    expect(register.mock.invocationCallOrder[0]).toBeLessThan(dispose.mock.invocationCallOrder[0]!)
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledTimes(1))
  })

  it('a throwing dispose is logged and the quit still proceeds', async () => {
    const teardownFailure = new Error('helper refused to stop')
    await expect(runStandaloneLaunch(launchOptions({ register: () => undefined, dispose: () => { throw teardownFailure } }))).resolves.toBe('started')
    mocks.emit('before-quit', { preventDefault: vi.fn() })
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledTimes(1))
    expect(errorLog).toHaveBeenCalledWith(teardownFailure)
    expect(app.quit).toHaveBeenCalledTimes(1)
  })

  it('window-all-closed: quits by default', async () => {
    await expect(runStandaloneLaunch(launchOptions({ register: () => undefined, dispose: () => undefined }))).resolves.toBe('started')
    mocks.emit('window-all-closed')
    expect(app.quit).toHaveBeenCalledTimes(1)
  })

  it('window-all-closed: boolean false keeps the app running', async () => {
    await expect(runStandaloneLaunch(launchOptions({ quitOnLastWindow: false, register: () => undefined, dispose: () => undefined }))).resolves.toBe('started')
    mocks.emit('window-all-closed')
    expect(app.quit).not.toHaveBeenCalled()
  })

  it('window-all-closed: the quit predicate is honored', async () => {
    let shouldQuit = false
    await expect(runStandaloneLaunch(launchOptions({ quitOnLastWindow: () => shouldQuit, register: () => undefined, dispose: () => undefined }))).resolves.toBe('started')
    mocks.emit('window-all-closed')
    expect(app.quit).not.toHaveBeenCalled()
    shouldQuit = true
    mocks.emit('window-all-closed')
    expect(app.quit).toHaveBeenCalledTimes(1)
  })

  it('userData override: applied before the lock and visible to register', async () => {
    process.env.MOIRASIA_TEST_USER_DATA = '/tmp/test-user-data'
    try {
      let observedUserData: string | undefined
      await expect(runStandaloneLaunch(launchOptions({
        userDataEnv: 'MOIRASIA_TEST_USER_DATA',
        register: () => { observedUserData = app.getPath('userData') },
        dispose: () => undefined
      }))).resolves.toBe('started')
      expect(app.setPath).toHaveBeenCalledWith('userData', '/tmp/test-user-data')
      expect(app.setPath.mock.invocationCallOrder[0]!).toBeLessThan(app.requestSingleInstanceLock.mock.invocationCallOrder[0]!)
      expect(observedUserData).toBe('/tmp/test-user-data')
    } finally {
      delete process.env.MOIRASIA_TEST_USER_DATA
    }
  })

  it('no setPath when the userData env var is unset', async () => {
    delete process.env.MOIRASIA_TEST_USER_DATA
    await expect(runStandaloneLaunch(launchOptions({ userDataEnv: 'MOIRASIA_TEST_USER_DATA', register: () => undefined, dispose: () => undefined }))).resolves.toBe('started')
    expect(app.setPath).not.toHaveBeenCalled()
  })

  it('control chain rejection: logs and exits 1', async () => {
    const failure = new Error('control protocol broke')
    mocks.runLoginItemControl.mockRejectedValueOnce(failure)
    await expect(runStandaloneLaunch(launchOptions({ register: () => undefined, dispose: () => undefined }))).resolves.toBe('launch-failed')
    expect(errorLog).toHaveBeenCalledWith(failure)
    expect(app.exit).toHaveBeenCalledWith(1)
    expect(app.quit).not.toHaveBeenCalled()
    expect(app.on).not.toHaveBeenCalled()
  })

  it('activates the product on activate and second-instance', async () => {
    const activate = vi.fn()
    await expect(runStandaloneLaunch(launchOptions({ activate, register: () => undefined, dispose: () => undefined }))).resolves.toBe('started')
    mocks.emit('second-instance')
    expect(activate).toHaveBeenCalledTimes(1)
    mocks.emit('activate')
    expect(activate).toHaveBeenCalledTimes(2)
  })

  it('tolerates activate and second-instance with no activate hook', async () => {
    await expect(runStandaloneLaunch(launchOptions({ register: () => undefined, dispose: () => undefined }))).resolves.toBe('started')
    expect(() => { mocks.emit('second-instance'); mocks.emit('activate') }).not.toThrow()
    expect(app.quit).not.toHaveBeenCalled()
    expect(app.exit).not.toHaveBeenCalled()
  })

  it('omits CSP and menu wiring when the options are absent', async () => {
    await expect(runStandaloneLaunch(launchOptions({ register: () => undefined, dispose: () => undefined }))).resolves.toBe('started')
    expect(mocks.onHeadersReceived).not.toHaveBeenCalled()
    expect(Menu.buildFromTemplate).not.toHaveBeenCalled()
    expect(Menu.setApplicationMenu).not.toHaveBeenCalled()
  })
})
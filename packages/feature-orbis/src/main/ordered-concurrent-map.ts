export interface OrderedConcurrentMapOptions {
  readonly signal?: AbortSignal
  readonly canceledError?: () => Error
}

export interface OrderedConcurrentMapper {
  readonly concurrency: number
  map<Input, Output>(
    items: readonly Input[],
    options: OrderedConcurrentMapOptions,
    operation: (item: Input, index: number) => Promise<Output>
  ): AsyncGenerator<Output>
}

type Settled<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: unknown }
type Pending<Value> = { readonly settled: Promise<Settled<Value>>; readonly releaseRecord: () => void }

export function createOrderedConcurrentMapper(value: number): OrderedConcurrentMapper {
  const concurrency = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
  const createBudget = (limit: number): (() => (() => void) | undefined) => {
    let available = limit
    return () => {
      if (available === 0) return undefined
      available -= 1
      let released = false
      return () => {
        if (released) return
        released = true
        available += 1
      }
    }
  }
  const tryAcquireOperation = createBudget(concurrency)
  let availableRecords = concurrency * 4
  const tryAcquireRecord = (allowLast: boolean): (() => void) | undefined => {
    if (availableRecords === 0 || !allowLast && availableRecords === 1) return undefined
    availableRecords -= 1
    let released = false
    return () => {
      if (released) return
      released = true
      availableRecords += 1
    }
  }

  const map = async function* <Input, Output>(
    items: readonly Input[],
    options: OrderedConcurrentMapOptions,
    operation: (item: Input, index: number) => Promise<Output>
  ): AsyncGenerator<Output> {
    const pending = new Map<number, Pending<Output>>()
    let nextToAdmit = 0

    const admit = (): void => {
      while (!options.signal?.aborted && nextToAdmit < items.length && pending.size < concurrency) {
        const releaseOperation = tryAcquireOperation()
        if (!releaseOperation) break
        const releaseRecord = tryAcquireRecord(pending.size === 0)
        if (!releaseRecord) { releaseOperation(); break }
        const index = nextToAdmit
        nextToAdmit += 1
        const settled: Promise<Settled<Output>> = Promise.resolve()
          .then(() => operation(items[index]!, index))
          .then(
            (result): Settled<Output> => ({ ok: true, value: result }),
            (error: unknown): Settled<Output> => ({ ok: false, error })
          )
          .finally(releaseOperation)
        pending.set(index, { settled, releaseRecord })
      }
    }

    const drain = async (): Promise<void> => {
      await Promise.all([...pending.values()].map(async ({ settled, releaseRecord }) => { await settled; releaseRecord() }))
      pending.clear()
    }
    const throwCanceled = (): never => { throw options.canceledError?.() ?? new Error("Operation canceled") }

    admit()
    try {
      for (let index = 0; index < items.length; index += 1) {
        if (options.signal?.aborted) throwCanceled()
        const admitted = pending.get(index)
        if (!admitted) throw new Error("Ordered concurrent mapper exhausted its shared admission budget")
        const result = await admitted.settled
        pending.delete(index)
        admitted.releaseRecord()
        if (!result.ok) throw result.error
        if (options.signal?.aborted) throwCanceled()
        yield result.value
        admit()
      }
    } finally {
      await drain()
    }
  }

  return { concurrency, map }
}

import { useCallback, useEffect, useRef, useState } from 'react'

/** Load async data on mount, with error capture and a reload handle. */
export function useLoad<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const reload = useCallback(async () => {
    try {
      setError(null)
      setData(await fnRef.current())
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => { reload() }, [reload])
  return { data, setData, error, reload }
}

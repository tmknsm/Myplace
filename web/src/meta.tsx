import { createContext, useContext, useEffect, useState } from "react";
import { api, type Meta } from "./api";

const MetaContext = createContext<Meta | null>(null);

/** Product metadata loaded once: coverage, vocab, and whether local debug shortcuts are on. */
export function MetaProvider({ children }: { children: React.ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    api.meta().then(setMeta).catch(() => undefined);
  }, []);
  return <MetaContext.Provider value={meta}>{children}</MetaContext.Provider>;
}

export function useMeta(): Meta | null {
  return useContext(MetaContext);
}

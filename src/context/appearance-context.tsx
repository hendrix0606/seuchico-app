import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { PropsWithChildren } from "react";
import { supabase } from "../lib/supabase";
import {
  DEFAULT_APPEARANCE,
  type AppAppearance,
} from "../types/appearance";

type AppearanceContextValue = {
  appearance: AppAppearance;
  isAppearanceLoading: boolean;
  refreshAppearance: () => Promise<void>;
};

const AppearanceContext = createContext<AppearanceContextValue | undefined>(
  undefined,
);

export function AppearanceProvider({ children }: PropsWithChildren) {
  const [appearance, setAppearance] = useState(DEFAULT_APPEARANCE);
  const [isAppearanceLoading, setIsAppearanceLoading] = useState(true);

  const refreshAppearance = async () => {
    const { data, error } = await supabase
      .from("app_branding_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (!error && data) {
      setAppearance(data as AppAppearance);
    }

    setIsAppearanceLoading(false);
  };

  useEffect(() => {
    void refreshAppearance();
  }, []);

  const value = useMemo(
    () => ({ appearance, isAppearanceLoading, refreshAppearance }),
    // refreshAppearance sempre usa o cliente atual do Supabase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appearance, isAppearanceLoading],
  );

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance() {
  const context = useContext(AppearanceContext);

  if (!context) {
    throw new Error("useAppearance precisa ser usado dentro de AppearanceProvider.");
  }

  return context;
}

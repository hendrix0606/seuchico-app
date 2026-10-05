import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { PropsWithChildren } from "react";
import { deactivateCurrentUserPushTokens } from "../lib/push-notifications";
import { supabase } from "../lib/supabase";

export type UserRole = "client" | "courier" | "admin";

export type UserProfile = {
  id: string;
  full_name: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  must_change_password: boolean;
};

type AuthContextValue = {
  session: Session | null;
  profile: UserProfile | null;
  isLoading: boolean;
  profileError: string | null;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) return;

      if (error) {
        setProfileError("Não foi possível recuperar a sessão.");
      }

      setSession(data.session);
      setIsSessionLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
        setIsSessionLoading(false);
      },
    );

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const loadProfile = async () => {
    const userId = session?.user.id;

    if (!userId) {
      setProfile(null);
      setProfileError(null);
      setIsProfileLoading(false);
      return;
    }

    setIsProfileLoading(true);
    setProfileError(null);

    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, phone, role, is_active, must_change_password")
      .eq("id", userId)
      .single();

    if (error) {
      setProfile(null);
      setProfileError(
        "Não foi possível carregar seu perfil. Tente novamente em instantes.",
      );
    } else {
      setProfile(data as UserProfile);
    }

    setIsProfileLoading(false);
  };

  useEffect(() => {
    void loadProfile();
    // A troca do usuário é o evento que exige uma nova leitura do perfil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  const signOut = async () => {
    await deactivateCurrentUserPushTokens();
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw error;
    }

    setProfile(null);
  };

  const value = useMemo(
    () => ({
      session,
      profile,
      isLoading:
        isSessionLoading ||
        isProfileLoading ||
        Boolean(session && !profile && !profileError),
      profileError,
      refreshProfile: loadProfile,
      signOut,
    }),
    // loadProfile always reads the current session before making the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, profile, isSessionLoading, isProfileLoading, profileError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth precisa ser usado dentro de AuthProvider.");
  }

  return context;
}

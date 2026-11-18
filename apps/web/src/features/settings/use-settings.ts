import { fetchSettings, updateSettings } from '@/lib/api';
import { settingsInputDefaults, type UpdateSettingsRequest } from '@nexter/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useRuntimeSettings() {
  const query = useSettings();
  return {
    ...settingsInputDefaults,
    ...(query.data ?? {}),
  };
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSettingsRequest) => updateSettings(body),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

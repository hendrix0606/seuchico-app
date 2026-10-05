import { Text, View } from "react-native";

export default function NativeWindTestScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-brand-background p-6">
      <View className="w-full max-w-md rounded-card bg-brand-primary p-8 shadow-lg">
        <Text className="text-3xl font-bold text-white">NativeWind ativo</Text>

        <Text className="mt-3 text-base text-brand-accent">
          O framework está funcionando no SeuChico.
        </Text>
      </View>
    </View>
  );
}

import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import DashboardScreen from '../screens/main/DashboardScreen';
import DetailScreen from '../screens/main/DetailScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import FormScreen from '../screens/main/FormScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import ModuleScreen from '../screens/main/ModuleScreen';
import ProfileScreen from '../screens/main/ProfileScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import ResourceScreen from '../screens/main/ResourceScreen';
import HourlyProductionScreen from '../screens/main/HourlyProductionScreen';
import QualityControlScreen from '../screens/main/QualityControlScreen';
import FinalCheckingScreen from '../screens/main/FinalCheckingScreen';
import FinalDetailScreen from '../screens/main/FinalDetailScreen';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme/colors';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

function BootScreen() {
  return (
    <View style={styles.boot}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.bootText}>Loading workspace...</Text>
    </View>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} options={{ headerShown: true, title: 'Register' }} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ headerShown: true, title: 'Forgot Password' }} />
    </Stack.Navigator>
  );
}

function WorkspaceStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '800' },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="DashboardHome" component={DashboardScreen} options={{ title: 'Dashboard' }} />
      <Stack.Screen name="Module" component={ModuleScreen} options={({ route }) => ({ title: route.params?.title || 'Module' })} />
      <Stack.Screen name="Resource" component={ResourceScreen} options={({ route }) => ({ title: route.params?.title || 'Records' })} />
      <Stack.Screen name="HourlyProduction" component={HourlyProductionScreen} options={{ title: 'Hourly Production' }} />
      <Stack.Screen name="Detail" component={DetailScreen} options={({ route }) => ({ title: route.params?.title || 'Detail' })} />
      <Stack.Screen name="Form" component={FormScreen} options={({ route }) => ({ title: route.params?.title || 'Add Record' })} />
      <Stack.Screen name="QualityControl" component={QualityControlScreen} options={{ title: 'Quality Control Board' }} />
      <Stack.Screen name="FinalChecking" component={FinalCheckingScreen} options={{ title: 'Final Checking Board' }} />
      <Stack.Screen name="FinalDetail" component={FinalDetailScreen} options={{ title: 'Final Inspection' }} />
    </Stack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: styles.tabBar,
        tabBarIcon: ({ color, size }) => {
          const names = {
            Dashboard: 'view-dashboard',
            Profile: 'account-circle',
          };
          return <MaterialCommunityIcons name={names[route.name] || 'circle'} size={size} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="Dashboard" component={WorkspaceStack} />
      <Tabs.Screen name="Profile" component={ProfileScreen} />
    </Tabs.Navigator>
  );
}

export default function RootNavigator() {
  const { user, loading } = useAuth();
  if (loading) return <BootScreen />;

  return (
    <NavigationContainer>
      {user ? <MainTabs /> : <AuthStack />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    gap: 12,
  },
  bootText: {
    color: colors.muted,
  },
  tabBar: {
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});

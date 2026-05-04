import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Card from '../../components/Card';
import LoadingState from '../../components/LoadingState';
import { listFinalJobs } from '../../api/client';
import { colors } from '../../theme/colors';
import { globalStyles } from '../../theme/styles';

export default function FinalCheckingScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState([]);
  const [stats, setStats] = useState({ pendingJobs: 0, pendingBatches: 0, totalPcs: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listFinalJobs();
      const jobList = res.data || res || [];
      setJobs(jobList);
      
      const pendingBatches = jobList.reduce((s, j) => s + (j.pendingCount || 0), 0);
      const totalPcs = jobList.reduce((s, j) => s + (j.pendingQty || 0), 0);
      setStats({
        pendingJobs: jobList.length,
        pendingBatches,
        totalPcs,
      });
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || err.message || 'Could not load final checking jobs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const renderJobItem = ({ item }) => (
    <Card style={styles.jobCard}>
      <Pressable 
        onPress={() => navigation.navigate('FinalDetail', { jobId: item._id, jobNumber: item.jobNumber })}
        style={({ pressed }) => [styles.jobPressable, pressed && styles.pressed]}
      >
        <View style={styles.jobHeader}>
          <View style={styles.jobTitleBlock}>
            <Text style={styles.jobNumber}>{item.jobNumber}</Text>
            <Text style={styles.productName} numberOfLines={1}>{item.productId?.name || 'Garment Item'}</Text>
            {item.productId?.sku && <Text style={styles.skuText}>{item.productId.sku}</Text>}
          </View>
          <MaterialCommunityIcons name="chevron-right" size={24} color={colors.muted} />
        </View>

        <View style={styles.jobStats}>
          <View style={styles.jobStatItem}>
            <Text style={styles.jobStatLabel}>Batches</Text>
            <Text style={styles.jobStatValue}>{item.pendingCount || 0}</Text>
          </View>
          <View style={styles.jobStatDivider} />
          <View style={styles.jobStatItem}>
            <Text style={styles.jobStatLabel}>Quantity</Text>
            <Text style={styles.jobStatValue}>{(item.pendingQty || 0).toLocaleString()} pcs</Text>
          </View>
        </View>
      </Pressable>
    </Card>
  );

  return (
    <SafeAreaView style={globalStyles.screen} edges={['left', 'right']}>
      {loading && jobs.length === 0 ? (
        <LoadingState />
      ) : (
        <FlatList
          data={jobs}
          renderItem={renderJobItem}
          keyExtractor={(item) => item._id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          ListHeaderComponent={
            <View style={styles.headerContainer}>
              <View style={styles.header}>
                <Text style={globalStyles.title}>Final Checking</Text>
                <Text style={globalStyles.subtitle}>Inspect and approve packing batches before stock.</Text>
              </View>

              {/* Stats Section */}
              <View style={styles.statsGrid}>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Jobs</Text>
                  <Text style={styles.statValue}>{stats.pendingJobs}</Text>
                </View>
                <View style={[styles.statCard, { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border }]}>
                  <Text style={styles.statLabel}>Batches</Text>
                  <Text style={[styles.statValue, { color: colors.warning }]}>{stats.pendingBatches}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statLabel}>Total Pcs</Text>
                  <Text style={[styles.statValue, { color: colors.primary }]}>{stats.totalPcs.toLocaleString()}</Text>
                </View>
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons name="clipboard-check-outline" size={64} color={colors.chip} />
              <Text style={styles.emptyTitle}>No jobs pending</Text>
              <Text style={styles.emptySubtitle}>Batches sent to final checking will appear here.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  header: {
    marginBottom: 20,
    gap: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 4,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 12,
  },
  jobCard: {
    padding: 0,
    overflow: 'hidden',
    borderRadius: 16,
  },
  jobPressable: {
    padding: 16,
  },
  jobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  jobTitleBlock: {
    flex: 1,
    gap: 2,
  },
  jobNumber: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  productName: {
    fontSize: 14,
    color: colors.muted,
  },
  skuText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
    marginTop: 2,
  },
  jobStats: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  jobStatItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  jobStatDivider: {
    width: 1,
    height: 20,
    backgroundColor: colors.border,
  },
  jobStatLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
  },
  jobStatValue: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  pressed: {
    opacity: 0.7,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});

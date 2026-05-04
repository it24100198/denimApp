import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Button from '../../components/Button';
import Card from '../../components/Card';
import LoadingState from '../../components/LoadingState';
import ScreenScaffold from '../../components/ScreenScaffold';
import StatusPill from '../../components/StatusPill';
import { getFinalJobDetail, finalizeBatch } from '../../api/client';
import { colors } from '../../theme/colors';

const fmt = (n) => Number(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function FinalDetailScreen({ route, navigation }) {
  const { jobId, jobNumber } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const res = await getFinalJobDetail(jobId);
      setData(res.data || res);
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || err.message || 'Could not load job details.');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleFinalize = async (batch) => {
    Alert.alert(
      'Finalize Batch',
      `This will add ${batch.quantity} pcs to product stock. Confirm?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm & Send to Stock',
          onPress: async () => {
            setSaving(true);
            try {
              await finalizeBatch(batch._id);
              Alert.alert('Success', 'Batch finalized and stock updated.');
              load();
            } catch (err) {
              Alert.alert('Error', err.response?.data?.error || err.message || 'Could not finalize batch.');
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  if (loading && !data) return <LoadingState />;

  const { job, batches, costSummary } = data || {};
  const cs = costSummary || {};
  const breakdown = cs.materialBreakdown || [];

  return (
    <ScreenScaffold 
      title={jobNumber || 'Final Check'} 
      subtitle={job?.productId?.name || 'Garment Item'}
      onRefresh={load}
    >
      <ScrollView contentContainerStyle={styles.container}>
        {/* Status Section */}
        <View style={styles.headerRow}>
          <StatusPill value={job?.status} />
          {batches?.every(b => b.status === 'completed') && (
            <View style={styles.allDoneBadge}>
              <MaterialCommunityIcons name="check-circle" size={14} color="#059669" />
              <Text style={styles.allDoneText}>All Batches Finalized</Text>
            </View>
          )}
        </View>

        {/* Cost Summary Cards */}
        <View style={styles.costGrid}>
          <Card style={styles.costCard}>
            <Text style={styles.costLabel}>Total Mat. Cost</Text>
            <Text style={styles.costValue}>LKR {fmt(cs.totalMaterialCost)}</Text>
          </Card>
          <Card style={[styles.costCard, styles.successCard]}>
            <Text style={[styles.costLabel, styles.successLabel]}>Good Pcs</Text>
            <Text style={[styles.costValue, styles.successValue]}>{(cs.totalGoodPcs || 0).toLocaleString()}</Text>
          </Card>
          <Card style={[styles.costCard, styles.primaryCard]}>
            <Text style={[styles.costLabel, styles.primaryLabel]}>Cost / Piece</Text>
            <Text style={[styles.costValue, styles.primaryValue]}>LKR {fmt(cs.costPerPieceGood)}</Text>
          </Card>
        </View>

        {/* Material Breakdown */}
        {breakdown.length > 0 && (
          <Card style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Material Cost Breakdown</Text>
            {breakdown.map((m, idx) => (
              <View key={m.materialId || idx} style={[styles.breakdownRow, idx === breakdown.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowName}>{m.name}</Text>
                  <Text style={styles.rowMeta}>{m.qtyIssued.toLocaleString()} {m.unit} @ {fmt(m.unitPrice)}</Text>
                </View>
                <View style={styles.rowValues}>
                  <Text style={styles.rowCost}>LKR {fmt(m.totalCost)}</Text>
                  <Text style={styles.rowPct}>{cs.totalMaterialCost > 0 ? Math.round((m.totalCost / cs.totalMaterialCost) * 100) : 0}%</Text>
                </View>
              </View>
            ))}
          </Card>
        )}

        {/* Packing Batches */}
        <Text style={styles.sectionTitleOutside}>Packing Batches</Text>
        {batches?.map((batch) => {
          const isPending = batch.status === 'sent_to_final_check';
          return (
            <Card key={batch._id} style={[styles.batchCard, !isPending && styles.completedBatch]}>
              <View style={styles.batchTop}>
                <View style={styles.batchInfo}>
                  <Text style={styles.batchCode}>{batch.batchCode || 'No Code'}</Text>
                  <View style={styles.batchMeta}>
                    <View style={[styles.typePill, batch.type === 'good' ? styles.successPill : styles.dangerPill]}>
                      <Text style={[styles.typeText, batch.type === 'good' ? styles.successText : styles.dangerText]}>
                        {batch.type?.toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.batchQty}>{batch.quantity} pcs</Text>
                  </View>
                </View>
                <StatusPill value={batch.status} />
              </View>

              {isPending ? (
                <Button 
                  title="Finalize & Send to Stock" 
                  onPress={() => handleFinalize(batch)}
                  loading={saving}
                  style={styles.finalizeBtn}
                  icon="check-bold"
                />
              ) : (
                <View style={styles.addedBadge}>
                  <MaterialCommunityIcons name="package-variant-closed-check" size={16} color="#059669" />
                  <Text style={styles.addedText}>Added to Stock</Text>
                </View>
              )}
            </Card>
          );
        })}
      </ScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  allDoneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  allDoneText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
  costGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  costCard: {
    flex: 1,
    minWidth: '45%',
    padding: 12,
    borderRadius: 16,
    gap: 4,
  },
  costLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
  },
  costValue: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  successCard: { backgroundColor: '#f0fdf4' },
  successLabel: { color: '#16a34a' },
  successValue: { color: '#065f46' },
  primaryCard: { backgroundColor: '#eff6ff' },
  primaryLabel: { color: '#2563eb' },
  primaryValue: { color: '#1e40af' },
  
  sectionCard: {
    padding: 16,
    borderRadius: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 16,
  },
  sectionTitleOutside: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    marginTop: 8,
    marginBottom: -4,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  rowMeta: {
    fontSize: 11,
    color: colors.muted,
  },
  rowValues: {
    alignItems: 'flex-end',
    gap: 2,
  },
  rowCost: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  rowPct: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '600',
  },
  batchCard: {
    padding: 16,
    borderRadius: 20,
  },
  completedBatch: {
    opacity: 0.7,
  },
  batchTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  batchInfo: {
    flex: 1,
    gap: 6,
  },
  batchCode: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  batchMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  successPill: { backgroundColor: '#f0fdf4' },
  dangerPill: { backgroundColor: '#fef2f2' },
  typeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  successText: { color: '#16a34a' },
  dangerText: { color: '#dc2626' },
  batchQty: {
    fontSize: 14,
    color: colors.muted,
    fontWeight: '600',
  },
  finalizeBtn: {
    marginTop: 4,
    height: 48,
    backgroundColor: '#059669',
  },
  addedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0fdf4',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    gap: 8,
  },
  addedText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#059669',
  },
});

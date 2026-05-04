import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Button from '../../components/Button';
import Card from '../../components/Card';
import LoadingState from '../../components/LoadingState';
import ScreenScaffold from '../../components/ScreenScaffold';
import TextField from '../../components/TextField';
import { getQcDetail, saveQc } from '../../api/client';
import { colors } from '../../theme/colors';

export default function QualityControlScreen({ route, navigation }) {
  const { transferId } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState(null);
  const [goodQty, setGoodQty] = useState('');
  const [damagedQty, setDamagedQty] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    if (!transferId) return;
    setLoading(true);
    try {
      const res = await getQcDetail(transferId);
      const payload = res.data || res;
      setData(payload);
      if (payload.qcCheck) {
        setGoodQty(String(payload.qcCheck.finishedGoodQty));
        setDamagedQty(String(payload.qcCheck.damagedQty));
        setNotes(payload.qcCheck.notes || '');
      }
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || err.message || 'Could not load QC details.');
    } finally {
      setLoading(false);
    }
  }, [transferId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const transfer = data?.transfer;
  const qcCheck = data?.qcCheck;
  const totalRequired = transfer?.quantitySent || 0;
  const goodN = Number(goodQty) || 0;
  const dmgN = Number(damagedQty) || 0;
  const sum = goodN + dmgN;
  const validQc = sum === totalRequired && totalRequired > 0;
  const remainder = totalRequired - sum;
  const progressPct = totalRequired > 0 ? Math.min(100, (sum / totalRequired) * 100) : 0;

  const handleSave = async () => {
    if (!validQc) {
      Alert.alert('Validation Error', `Total quantity (${sum}) must match transfer quantity (${totalRequired}).`);
      return;
    }
    setSaving(true);
    try {
      await saveQc(transferId, {
        finishedGoodQty: goodN,
        damagedQty: dmgN,
        notes: notes.trim(),
      });
      Alert.alert('Success', 'QC results saved successfully.', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (err) {
      Alert.alert('Save Failed', err.response?.data?.error || err.message || 'Could not save QC results.');
    } finally {
      setSaving(false);
    }
  };

  const quickFillGood = () => {
    if (remainder > 0) {
      setGoodQty(String(goodN + remainder));
    }
  };

  const quickFillDamaged = () => {
    if (remainder > 0) {
      setDamagedQty(String(dmgN + remainder));
    }
  };

  if (loading) return <LoadingState />;

  return (
    <ScreenScaffold>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Header Info */}
        <Card style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={styles.iconCircle}>
              <MaterialCommunityIcons name="clipboard-check-outline" size={24} color={colors.primary} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.jobTitle}>{data?.job?.jobNumber || 'Manufacturing Job'}</Text>
              <Text style={styles.productName}>{data?.job?.productId?.name || 'Garment Item'}</Text>
              {data?.job?.productId?.sku && <Text style={styles.skuText}>SKU: {data.job.productId.sku}</Text>}
            </View>
          </View>
          
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Expected</Text>
              <Text style={styles.statValue}>{totalRequired} pcs</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Allocated</Text>
              <Text style={[styles.statValue, validQc ? styles.successText : styles.primaryText]}>
                {sum} / {totalRequired}
              </Text>
            </View>
          </View>

          {/* Progress Bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressTrack}>
              <View 
                style={[
                  styles.progressFill, 
                  { width: `${progressPct}%` },
                  sum > totalRequired ? { backgroundColor: colors.danger } : {}
                ]} 
              />
            </View>
            <View style={styles.progressLabels}>
              <Text style={styles.progressText}>Progress</Text>
              <Text style={styles.progressText}>{Math.round(progressPct)}%</Text>
            </View>
          </View>
        </Card>

        {qcCheck ? (
          <Card style={styles.resultsCard}>
            <View style={styles.cardHeader}>
              <MaterialCommunityIcons name="check-decagram" size={20} color={colors.success} />
              <Text style={styles.cardTitle}>QC RESULTS COMPLETED</Text>
            </View>
            <View style={styles.summaryGrid}>
              <View style={[styles.summaryItem, styles.successBg]}>
                <Text style={styles.summaryLabel}>GOOD</Text>
                <Text style={styles.summaryValue}>{qcCheck.finishedGoodQty} pcs</Text>
              </View>
              <View style={[styles.summaryItem, styles.dangerBg]}>
                <Text style={styles.summaryLabel}>DAMAGED</Text>
                <Text style={styles.summaryValue}>{qcCheck.damagedQty} pcs</Text>
              </View>
            </View>
            {qcCheck.notes ? (
              <View style={styles.notesBox}>
                <Text style={styles.notesLabel}>Notes</Text>
                <Text style={styles.notesText}>{qcCheck.notes}</Text>
              </View>
            ) : null}
            <Button 
              title="Go Back" 
              onPress={() => navigation.goBack()} 
              variant="secondary"
              style={styles.doneButton}
            />
          </Card>
        ) : (
          <View style={styles.formContainer}>
            <Text style={styles.sectionTitle}>Enter QC Quantities</Text>
            
            <View style={styles.inputGrid}>
              <View style={styles.inputWrapper}>
                <TextField
                  label="Finished Good"
                  value={goodQty}
                  onChangeText={setGoodQty}
                  keyboardType="numeric"
                  placeholder="0"
                  icon="check-circle-outline"
                />
              </View>
              <View style={styles.inputWrapper}>
                <TextField
                  label="Damaged"
                  value={damagedQty}
                  onChangeText={setDamagedQty}
                  keyboardType="numeric"
                  placeholder="0"
                  icon="alert-circle-outline"
                />
              </View>
            </View>

            {/* Quick Actions */}
            {remainder > 0 && (
              <View style={styles.quickActions}>
                <Button 
                  title={`+ ${remainder} to Good`} 
                  onPress={quickFillGood}
                  variant="outline"
                  size="small"
                  icon="plus"
                  style={styles.quickButton}
                />
                <Button 
                  title={`+ ${remainder} to Damage`} 
                  onPress={quickFillDamaged}
                  variant="outline"
                  size="small"
                  icon="plus"
                  style={styles.quickButton}
                />
              </View>
            )}

            <TextField
              label="Remarks / Notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Add any QC observations..."
              multiline
              numberOfLines={3}
              icon="comment-text-outline"
            />

            {/* Validation Message */}
            {!validQc && totalRequired > 0 && (
              <View style={[styles.validationBox, sum > totalRequired ? styles.errorBox : styles.warningBox]}>
                <MaterialCommunityIcons 
                  name={sum > totalRequired ? 'alert-octagon' : 'information'} 
                  size={18} 
                  color={sum > totalRequired ? colors.danger : colors.warning} 
                />
                <Text style={[styles.validationText, sum > totalRequired ? styles.errorText : styles.warningText]}>
                  {sum > totalRequired 
                    ? `Exceeds by ${sum - totalRequired} pcs. Please correct.`
                    : `${remainder} pcs remaining to be allocated.`}
                </Text>
              </View>
            )}

            <Button
              title={saving ? "Saving Results..." : "Complete QC & Generate Batches"}
              onPress={handleSave}
              disabled={!validQc || saving}
              loading={saving}
              style={styles.saveButton}
              icon="checkbox-marked-circle-outline"
            />
          </View>
        )}
      </ScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 16,
  },
  headerCard: {
    padding: 20,
    borderRadius: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 16,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  jobTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5,
  },
  productName: {
    fontSize: 15,
    color: colors.muted,
    marginTop: 2,
  },
  skuText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
    marginTop: 4,
    textTransform: 'uppercase',
  },
  statsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: colors.border,
  },
  statLabel: {
    fontSize: 12,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  progressContainer: {
    marginTop: 4,
  },
  progressTrack: {
    height: 10,
    backgroundColor: colors.background,
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 5,
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'between',
    marginTop: 8,
  },
  progressText: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: '600',
  },
  formContainer: {
    gap: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: -8,
    marginLeft: 4,
  },
  inputGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  inputWrapper: {
    flex: 1,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: -10,
  },
  quickButton: {
    flex: 1,
    minHeight: 44,
  },
  validationBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    gap: 10,
  },
  warningBox: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  validationText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  warningText: {
    color: '#92400e',
  },
  errorText: {
    color: colors.danger,
  },
  saveButton: {
    marginTop: 8,
    height: 56,
  },
  resultsCard: {
    padding: 24,
    borderRadius: 20,
    alignItems: 'center',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.success,
    letterSpacing: 1,
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 16,
    width: '100%',
    marginBottom: 24,
  },
  summaryItem: {
    flex: 1,
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
  },
  successBg: {
    backgroundColor: '#f0fdf4',
  },
  dangerBg: {
    backgroundColor: '#fef2f2',
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 1,
    marginBottom: 6,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  notesBox: {
    width: '100%',
    padding: 16,
    backgroundColor: colors.background,
    borderRadius: 12,
    marginBottom: 24,
  },
  notesLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    marginBottom: 4,
  },
  notesText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  doneButton: {
    width: '100%',
  },
  successText: { color: colors.success },
  primaryText: { color: colors.primary },
});

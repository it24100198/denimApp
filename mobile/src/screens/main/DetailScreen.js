import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ScreenScaffold from '../../components/ScreenScaffold';
import StatusPill from '../../components/StatusPill';
import { assignLines, completeLine, createWashingTransfer, getAssignLinesMeta, getCustomerOrder, getHourlyRecords, getJob, saveCutting, sendJobToCutting, updateOrderStatus } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import { detailEntries, titleFor } from '../../utils/dataShape';

const readable = (key) => key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ');
const orderStages = [
  { key: 'confirmed', label: 'Order Confirmed', progress: 5 },
  { key: 'in_production', label: 'In Production', progress: 20 },
  { key: 'cutting', label: 'Cutting', progress: 40 },
  { key: 'washing', label: 'Washing', progress: 55 },
  { key: 'qc', label: 'QC / Final Check', progress: 70 },
  { key: 'packing', label: 'Packing', progress: 85 },
  { key: 'delivered', label: 'Delivered', progress: 100 },
];
const orderStatusLabel = (status) => orderStages.find((stage) => stage.key === status)?.label || readable(String(status || 'confirmed'));
const clampProgress = (value) => Math.max(0, Math.min(100, Number(value || 0)));
const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('en-GB');
};
const formatDateTime = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
};
const manufacturingSteps = [
  { key: 'FABRIC_ISSUED', label: 'Material Issued', icon: 'package-variant-closed-check' },
  { key: 'CUTTING_COMPLETED', label: 'Cutting Completed', icon: 'content-cut' },
  { key: 'LINE_ASSIGNED', label: 'Line Assigned', icon: 'account-switch-outline' },
  { key: 'LINE_IN_PROGRESS', label: 'Line In Progress', icon: 'progress-clock' },
  { key: 'LINE_COMPLETED', label: 'Line Completed', icon: 'check-decagram-outline' },
  { key: 'WASHING_OUT', label: 'Washing', icon: 'washing-machine' },
  { key: 'AFTER_WASH_RECEIVED', label: 'QC Pending', icon: 'clipboard-search-outline' },
  { key: 'PACKING_COMPLETED', label: 'QC Passed / Failed', icon: 'clipboard-check-outline' },
  { key: 'WAREHOUSE_RECEIVED', label: 'Completed', icon: 'flag-checkered' },
];
const manufacturingOrder = {
  FABRIC_ISSUED: 0,
  SENT_TO_CUTTING: 0.5,
  CUTTING_COMPLETED: 1,
  LINE_ASSIGNED: 2,
  LINE_IN_PROGRESS: 3,
  LINE_COMPLETED: 4,
  WASHING_OUT: 5,
  AFTER_WASH_RECEIVED: 6,
  PACKING_COMPLETED: 7,
  WAREHOUSE_RECEIVED: 8,
};
const manufacturingLabel = (status) => {
  if (status === 'SENT_TO_CUTTING') return 'Sent To Cutting';
  return manufacturingSteps.find((step) => step.key === status)?.label || readable(String(status || 'pending'));
};
const nextActionForJob = (status) => ({
  FABRIC_ISSUED: {
    title: 'Send to Cutting',
    subtitle: 'Fabric issue is complete. Move this job to the cutting board.',
    action: 'send_to_cutting',
    icon: 'send-outline',
  },
  SENT_TO_CUTTING: {
    title: 'Enter Cutting Results',
    subtitle: 'Record fabric used, waste, cut pieces, and rejects.',
    action: 'cutting_form',
    icon: 'content-cut',
  },
  CUTTING_COMPLETED: {
    title: 'Assign to Line',
    subtitle: 'Choose product and production line before line production starts.',
    action: 'assign_line_form',
    icon: 'account-switch-outline',
  },
  LINE_ASSIGNED: {
    title: 'Start Hourly Output Entry',
    subtitle: 'Open hourly production entry and start recording output.',
    action: 'hourly_board',
    icon: 'clock-edit-outline',
  },
  LINE_IN_PROGRESS: {
    title: 'Complete Line Production',
    subtitle: 'Mark line production complete when assigned quantity is done.',
    action: 'complete_line',
    icon: 'check-decagram-outline',
  },
  LINE_COMPLETED: {
    title: 'Send to Washing',
    subtitle: 'Create washing gate pass for completed line output.',
    action: 'washing_form',
    icon: 'washing-machine',
  },
  WASHING_OUT: {
    title: 'Open Washing Board',
    subtitle: 'Receive incoming gate pass, complete washing, then move to QC.',
    action: 'washing_board',
    icon: 'view-dashboard-outline',
  },
  AFTER_WASH_RECEIVED: {
    title: 'Open QC Board',
    subtitle: 'Enter QC results, split good and damaged quantities.',
    action: 'qc_board',
    icon: 'clipboard-check-outline',
  },
  PACKING_COMPLETED: {
    title: 'Open Final Checking',
    subtitle: 'Finalize packing batches and receive finished goods.',
    action: 'final_board',
    icon: 'package-check',
  },
  WAREHOUSE_RECEIVED: {
    title: 'Finished',
    subtitle: 'This job has completed the full manufacturing workflow.',
    action: '',
    icon: 'flag-checkered',
  },
}[status] || {
  title: 'Review Job',
  subtitle: 'Open the related board for the current workflow stage.',
  action: '',
  icon: 'information-outline',
});

export default function DetailScreen({ route, navigation }) {
  const { user } = useAuth();
  const initialRecord = route.params?.record || {};
  const isOrderDetail = route.params?.moduleKey === 'orders' && route.params?.itemKey === 'all-orders';
  const isManufacturingDetail = route.params?.moduleKey === 'manufacturing';
  const [record, setRecord] = useState(initialRecord);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const [manufacturingModal, setManufacturingModal] = useState('');
  const [manufacturingMeta, setManufacturingMeta] = useState({ lines: [], products: [] });
  const [manufacturingForm, setManufacturingForm] = useState({
    fabricUsedQty: '',
    fabricWasteQty: '',
    totalCutPieces: '',
    cuttingRejectQty: '0',
    productId: '',
    lineName: '',
    assignedQuantity: '',
    dispatchDate: new Date().toISOString().slice(0, 10),
    quantitySent: '',
    sentFrom: '',
  });

  const openStatusModal = () => {
    setSelectedStatus('');
    setStatusNote('');
    setStatusModalOpen(true);
  };

  const closeStatusModal = () => {
    if (savingStatus) return;
    setStatusModalOpen(false);
    setSelectedStatus('');
    setStatusNote('');
  };

  const confirmStatusUpdate = async () => {
    if (!record?._id || !selectedStatus) {
      Alert.alert('Status required', 'Please select the next stage.');
      return;
    }

    setSavingStatus(true);
    try {
      await updateOrderStatus(record._id, { status: selectedStatus, note: statusNote.trim() });
      const fresh = await getCustomerOrder(record._id);
      setRecord(fresh?.data ?? fresh);
      setStatusModalOpen(false);
      Alert.alert('Status updated', `Order moved to ${orderStatusLabel(selectedStatus)}.`);
    } catch (err) {
      Alert.alert('Update failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not update order status.');
    } finally {
      setSavingStatus(false);
    }
  };

  const reloadManufacturingJob = async () => {
    if (!record?._id) return;
    try {
      const fresh = await getJob(record._id);
      setRecord(fresh?.data ?? fresh);
    } catch {
      // Some manufacturing sub-screens provide transfer records, not direct job ids.
    }
  };

  const updateManufacturingForm = (key, value) => setManufacturingForm((prev) => ({ ...prev, [key]: value }));

  const openManufacturingModal = async (type) => {
    if (type === 'assign_line_form') {
      setSavingStatus(true);
      try {
        const res = await getAssignLinesMeta(record._id);
        const meta = res?.data ?? res ?? {};
        const lines = Array.isArray(meta.lines) ? meta.lines : [];
        const products = Array.isArray(meta.products) ? meta.products : [];
        setManufacturingMeta({ lines, products });
        setManufacturingForm((prev) => ({
          ...prev,
          productId: prev.productId || products[0]?._id || '',
          lineName: prev.lineName || lines[0]?.name || lines[0]?.slug || '',
          assignedQuantity: prev.assignedQuantity || String(record?.totalCutPieces ?? ''),
        }));
        setManufacturingModal(type);
      } catch (err) {
        Alert.alert('Line assignment', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not load line assignment options.');
      } finally {
        setSavingStatus(false);
      }
      return;
    }

    if (type === 'cutting_form') {
      setManufacturingForm((prev) => ({
        ...prev,
        fabricUsedQty: prev.fabricUsedQty || String(record?.issuedFabricQuantity ?? ''),
        totalCutPieces: prev.totalCutPieces || '',
        cuttingRejectQty: prev.cuttingRejectQty || '0',
      }));
    }

    if (type === 'washing_form') {
      const firstLine = Array.isArray(record?.lineAssignments) ? record.lineAssignments[0] : null;
      setManufacturingForm((prev) => ({
        ...prev,
        quantitySent: prev.quantitySent || String(record?.availableToSend || record?.totalCutPieces || ''),
        sentFrom: prev.sentFrom || firstLine?.lineName || '',
      }));
    }

    setManufacturingModal(type);
  };

  const closeManufacturingModal = () => {
    if (savingStatus) return;
    setManufacturingModal('');
  };

  const submitCuttingResults = async () => {
    const payload = {
      fabricUsedQty: Number(manufacturingForm.fabricUsedQty),
      fabricWasteQty: Number(manufacturingForm.fabricWasteQty),
      totalCutPieces: Number(manufacturingForm.totalCutPieces),
      cuttingRejectQty: Number(manufacturingForm.cuttingRejectQty),
    };
    if (!Number.isFinite(payload.fabricUsedQty) || payload.fabricUsedQty < 0) return Alert.alert('Cutting', 'Fabric used quantity is required.');
    if (!Number.isFinite(payload.fabricWasteQty) || payload.fabricWasteQty < 0) return Alert.alert('Cutting', 'Fabric waste quantity is required.');
    if (!Number.isInteger(payload.totalCutPieces) || payload.totalCutPieces < 0) return Alert.alert('Cutting', 'Total cut pieces must be a whole number.');
    if (!Number.isInteger(payload.cuttingRejectQty) || payload.cuttingRejectQty < 0) return Alert.alert('Cutting', 'Reject quantity must be a whole number.');

    setSavingStatus(true);
    try {
      await saveCutting(record._id, payload);
      await reloadManufacturingJob();
      setManufacturingModal('');
      Alert.alert('Cutting completed', 'Cutting results saved. Next step is Assign to Line.');
    } catch (err) {
      Alert.alert('Cutting failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not save cutting results.');
    } finally {
      setSavingStatus(false);
    }
  };

  const submitLineAssignment = async () => {
    const assignedQuantity = Number(manufacturingForm.assignedQuantity);
    if (!manufacturingForm.productId) return Alert.alert('Assign line', 'Select a product.');
    if (!manufacturingForm.lineName) return Alert.alert('Assign line', 'Select a line.');
    if (!Number.isInteger(assignedQuantity) || assignedQuantity < 0) return Alert.alert('Assign line', 'Assigned quantity must be a whole number.');

    setSavingStatus(true);
    try {
      await assignLines(record._id, {
        productId: manufacturingForm.productId,
        assignments: [{
          lineName: manufacturingForm.lineName,
          assignedQuantity,
          dispatchDate: manufacturingForm.dispatchDate || new Date().toISOString().slice(0, 10),
        }],
      });
      await reloadManufacturingJob();
      setManufacturingModal('');
      Alert.alert('Line assigned', 'Job assigned to line. Next step is hourly output entry.');
    } catch (err) {
      Alert.alert('Assignment failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not assign line.');
    } finally {
      setSavingStatus(false);
    }
  };

  const submitWashingTransfer = async () => {
    const quantitySent = Number(manufacturingForm.quantitySent);
    if (!Number.isFinite(quantitySent) || quantitySent <= 0) return Alert.alert('Washing', 'Quantity sent must be greater than 0.');
    setSavingStatus(true);
    try {
      await createWashingTransfer({
        jobId: record._id,
        quantitySent,
        sentFrom: manufacturingForm.sentFrom.trim(),
      });
      await reloadManufacturingJob();
      setManufacturingModal('');
      Alert.alert('Sent to washing', 'Washing gate pass created. Open Washing Board to receive it.');
    } catch (err) {
      Alert.alert('Washing failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not create washing transfer.');
    } finally {
      setSavingStatus(false);
    }
  };

  const runNextStepAction = (action) => {
    if (!action) return;
    if (['cutting_form', 'assign_line_form', 'washing_form'].includes(action)) {
      openManufacturingModal(action);
      return;
    }
    if (action === 'send_to_cutting') {
      Alert.alert('Send to Cutting', 'Move this job to Cutting?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: () => runManufacturingAction('send_to_cutting') },
      ]);
      return;
    }
    if (action === 'hourly_board') {
      navigation.navigate('HourlyProduction', { jobId: record?._id });
      return;
    }
    if (action === 'complete_line') {
      // Verify hourly records have employee data
      (async () => {
        try {
          const recRes = await getHourlyRecords(record?._id);
          const recs = Array.isArray(recRes?.data) ? recRes.data : recRes?.data?.data || [];
          const hasEmp = recs.some(r => r.employeeId);
          if (!hasEmp) {
            Alert.alert('Missing Production Data', 'Record hourly production with an operator before completing the line.');
            return;
          }
          // proceed with completion
          runManufacturingAction('complete_line');
        } catch (e) {
          Alert.alert('Error', e.message || 'Failed to verify hourly records.');
        }
      })();
      return;
    }
    if (action === 'washing_board') {
      navigation.navigate('Resource', { moduleKey: 'manufacturing', itemKey: 'washing', title: 'Washing Gatepass' });
      return;
    }
    if (action === 'qc_board') {
      if (record?.quantitySent && record?._id) {
        navigation.navigate('QualityControl', { transferId: record._id });
      } else {
        navigation.navigate('Resource', { moduleKey: 'manufacturing', itemKey: 'qc', title: 'QC Checking' });
      }
      return;
    }
    if (action === 'final_board') {
      navigation.navigate('FinalChecking');
    }
  };

const runManufacturingAction = async (action) => {
  if (!record?._id) return;
  setSavingStatus(true);
  try {
    if (action === 'send_to_cutting') {
      await sendJobToCutting(record._id);
      await reloadManufacturingJob();
      Alert.alert('Updated', 'Job moved to cutting.');
    } else if (action === 'complete_line') {
      await completeLine(record._id);
      await reloadManufacturingJob();
      Alert.alert('Updated', 'Line completed successfully.');
    } else {
      Alert.alert('Action ready', 'This action needs the related production form data before it can be submitted.');
    }
  } catch (err) {
    Alert.alert('Action failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not update this job.');
  } finally {
    setSavingStatus(false);
  }
};

if (isOrderDetail) {
  const currentIndex = orderStages.findIndex((stage) => stage.key === record?.status);
  const progress = clampProgress(record?.completionPercentage || orderStages[Math.max(currentIndex, 0)]?.progress);
  const history = Array.isArray(record?.statusHistory) ? record.statusHistory.slice().reverse() : [];
  const nextStageOptions = currentIndex >= 0 ? orderStages.slice(currentIndex + 1) : orderStages;

  return (
    <ScreenScaffold title={route.params?.title || record?.orderNumber || 'Order Details'} subtitle="Order lifecycle, status, activity, and delivery details.">
      <Card style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroTitleBlock}>
            <Text style={styles.title}>{record?.orderNumber || 'Order'}</Text>
            <Text style={styles.subtitle}>{record?.customerName || '-'}</Text>
          </View>
          <StatusPill value={record?.status || 'confirmed'} />
        </View>
        <View style={styles.progressBlock}>
          <View style={styles.progressHeader}>
            <Text style={styles.label}>Completion Progress</Text>
            <Text style={styles.progressText}>{progress}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
        </View>
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Order Summary</Text>
        <View style={styles.summaryGrid}>
          <SummaryItem label="Order ID" value={record?.orderNumber || record?._id || '-'} />
          <SummaryItem label="Customer" value={record?.customerName || '-'} />
          <SummaryItem label="Quantity" value={record?.quantity || 0} />
          <SummaryItem label="Confirmed Date" value={formatDate(record?.confirmedDate || record?.createdAt)} />
          <SummaryItem label="Expected Delivery" value={formatDate(record?.expectedDeliveryDate)} />
          <SummaryItem label="Status" value={orderStatusLabel(record?.status)} />
        </View>
        {!!record?.productDescription && (
          <View style={styles.descriptionBox}>
            <Text style={styles.label}>Product</Text>
            <Text style={styles.value}>{record.productDescription}</Text>
          </View>
        )}
        <Button title="Update Status" disabled={nextStageOptions.length === 0} onPress={openStatusModal} style={styles.updateButton} />
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Order Lifecycle</Text>
        <View style={styles.stepper}>
          {orderStages.map((stage, index) => {
            const done = index <= currentIndex;
            const active = stage.key === record?.status;
            return (
              <View key={stage.key} style={styles.stepRow}>
                <View style={styles.stepMarkerWrap}>
                  <View style={[styles.stepMarker, done && styles.stepMarkerDone, active && styles.stepMarkerActive]}>
                    {done ? <MaterialCommunityIcons name="check" size={13} color="#fff" /> : null}
                  </View>
                  {index < orderStages.length - 1 ? <View style={[styles.stepLine, done && styles.stepLineDone]} /> : null}
                </View>
                <View style={styles.stepContent}>
                  <Text style={[styles.stepTitle, done && styles.stepTitleDone]}>{stage.label}</Text>
                  <Text style={styles.stepMeta}>{stage.progress}% complete</Text>
                </View>
              </View>
            );
          })}
        </View>
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Activity Log</Text>
        {history.length ? history.map((entry, index) => (
          <View key={`${entry?.timestamp || index}-${entry?.status}`} style={styles.activityRow}>
            <View style={styles.activityDot} />
            <View style={styles.activityContent}>
              <Text style={styles.activityStatus}>{orderStatusLabel(entry?.status)}</Text>
              {!!entry?.note && <Text style={styles.activityNote}>{entry.note}</Text>}
              <Text style={styles.activityDate}>{formatDateTime(entry?.timestamp)}</Text>
            </View>
          </View>
        )) : (
          <Text style={styles.emptyText}>No activity log found.</Text>
        )}
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Notes</Text>
        <Text style={record?.notes ? styles.value : styles.emptyText}>{record?.notes || 'No additional notes.'}</Text>
      </Card>

      <Modal visible={statusModalOpen} transparent animationType="slide" onRequestClose={closeStatusModal}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeStatusModal} />
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.modalTitle}>Update Status</Text>
            <Text style={styles.modalSubtitle}>Select the next stage for {record?.orderNumber || 'this order'}.</Text>
            <View style={styles.statusGrid}>
              {nextStageOptions.length ? nextStageOptions.map((stage) => {
                const selected = selectedStatus === stage.key;
                return (
                  <Pressable
                    key={stage.key}
                    onPress={() => setSelectedStatus(stage.key)}
                    style={({ pressed }) => [styles.statusOption, selected && styles.statusOptionSelected, pressed && styles.pressed]}
                  >
                    <Text style={[styles.statusOptionText, selected && styles.statusOptionTextSelected]}>{stage.label}</Text>
                  </Pressable>
                );
              }) : <Text style={styles.emptyText}>This order is already delivered.</Text>}
            </View>
            <TextInput
              value={statusNote}
              onChangeText={setStatusNote}
              placeholder="Note (optional)"
              placeholderTextColor={colors.muted}
              multiline
              textAlignVertical="top"
              style={styles.noteInput}
            />
            <Button title="Save Status" loading={savingStatus} disabled={!selectedStatus || savingStatus} onPress={confirmStatusUpdate} />
            <Button title="Cancel" variant="secondary" disabled={savingStatus} onPress={closeStatusModal} />
          </View>
        </View>
      </Modal>
    </ScreenScaffold>
  );
}

if (isManufacturingDetail) {
  const currentProgress = manufacturingOrder[record?.status] ?? 0;
  const percent = Math.round((Math.min(currentProgress, manufacturingSteps.length - 1) / (manufacturingSteps.length - 1)) * 100);
  const role = user?.role || 'employee';
  const isSupervisor = ['admin', 'manager', 'supervisor'].includes(role);
  const isWorker = ['operator', 'employee'].includes(role);
  const isQc = isSupervisor || String(role).includes('qc');
  const nextAction = nextActionForJob(record?.status);

  return (
    <ScreenScaffold title={route.params?.title || record?.jobNumber || 'Job Detail'} subtitle="Manufacturing workflow timeline and role-based actions.">
      <Card style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroTitleBlock}>
            <Text style={styles.title}>{record?.jobNumber || titleFor(record)}</Text>
            <Text style={styles.subtitle}>{record?.productId?.name || record?.styleRef || record?.batchRef || 'Manufacturing job'}</Text>
          </View>
          <StatusPill value={manufacturingLabel(record?.status)} />
        </View>
        <View style={styles.progressBlock}>
          <View style={styles.progressHeader}>
            <Text style={styles.label}>Workflow Progress</Text>
            <Text style={styles.progressText}>{percent}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${percent}%` }]} />
          </View>
        </View>
      </Card>

      <Card style={[styles.section, styles.nextActionCard]}>
        <View style={styles.heroTop}>
          <View style={styles.heroTitleBlock}>
            <Text style={styles.sectionTitle}>Next Step Actions</Text>
            <Text style={styles.nextActionTitle}>{nextAction.title}</Text>
            <Text style={styles.subtitle}>{nextAction.subtitle}</Text>
          </View>
          <View style={styles.nextActionIcon}>
            <MaterialCommunityIcons name={nextAction.icon} size={24} color="#fff" />
          </View>
        </View>
        {!!nextAction.action && (
          <Button title={nextAction.title} loading={savingStatus} onPress={() => runNextStepAction(nextAction.action)} style={styles.updateButton} />
        )}
        {['WASHING_OUT', 'AFTER_WASH_RECEIVED', 'PACKING_COMPLETED'].includes(record?.status) && (
          <Button
            title={record.status === 'WASHING_OUT' ? 'Open Washing Board' : record.status === 'AFTER_WASH_RECEIVED' ? 'Open QC Board' : 'Open Final Checking'}
            variant="secondary"
            onPress={() => runNextStepAction(record.status === 'WASHING_OUT' ? 'washing_board' : record.status === 'AFTER_WASH_RECEIVED' ? 'qc_board' : 'final_board')}
          />
        )}
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Job Summary</Text>
        <View style={styles.summaryGrid}>
          <SummaryItem label="Job Number" value={record?.jobNumber || '-'} />
          <SummaryItem label="Style / Batch" value={record?.styleRef || record?.batchRef || '-'} />
          <SummaryItem label="Issued Fabric" value={record?.issuedFabricQuantity ?? '-'} />
          <SummaryItem label="Cut Pieces" value={record?.totalCutPieces ?? '-'} />
          <SummaryItem label="Current Step" value={manufacturingLabel(record?.status)} />
          <SummaryItem label="Issue Date" value={formatDate(record?.issueDate || record?.createdAt)} />
        </View>
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Workflow Timeline</Text>
        <View style={styles.stepper}>
          {manufacturingSteps.map((step, index) => {
            const done = index < currentProgress || record?.status === 'WAREHOUSE_RECEIVED';
            const active = Math.floor(currentProgress) === index && record?.status !== 'WAREHOUSE_RECEIVED';
            return (
              <View key={step.key} style={styles.stepRow}>
                <View style={styles.stepMarkerWrap}>
                  <View style={[styles.stepMarker, done && styles.stepMarkerDone, active && styles.stepMarkerActive]}>
                    <MaterialCommunityIcons name={done ? 'check' : active ? 'sync' : 'clock-outline'} size={13} color={done || active ? '#fff' : colors.muted} />
                  </View>
                  {index < manufacturingSteps.length - 1 ? <View style={[styles.stepLine, (done || active) && styles.stepLineDone]} /> : null}
                </View>
                <View style={styles.stepContent}>
                  <Text style={[styles.stepTitle, (done || active) && styles.stepTitleDone]}>{step.label}</Text>
                  <Text style={styles.stepMeta}>{active ? 'Current step' : done ? 'Completed' : 'Pending'}</Text>
                </View>
              </View>
            );
          })}
        </View>
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Action Buttons</Text>
        {isSupervisor && (
          <View style={styles.actionGrid}>
            <Button title="Assign Line" variant="secondary" onPress={() => runManufacturingAction('assign_line')} style={styles.actionButton} />
            <Button title="Update Status" onPress={() => runManufacturingAction(record?.status === 'FABRIC_ISSUED' ? 'send_to_cutting' : 'update_status')} loading={savingStatus} style={styles.actionButton} />
            <Button title="Approve QC" variant="secondary" onPress={() => runManufacturingAction('approve_qc')} style={styles.actionButton} />
          </View>
        )}
        {isWorker && (
          <View style={styles.actionGrid}>
            <Button title="Start Work" variant="secondary" onPress={() => runManufacturingAction('start_work')} style={styles.actionButton} />
            <Button title="Complete Step" onPress={() => runManufacturingAction('complete_line')} loading={savingStatus} style={styles.actionButton} />
          </View>
        )}
        {isQc && (
          <View style={styles.actionGrid}>
            <Button title="Pass" variant="secondary" onPress={() => runManufacturingAction('qc_pass')} style={styles.actionButton} />
            <Button title="Fail" variant="danger" onPress={() => runManufacturingAction('qc_fail')} style={styles.actionButton} />
            <Button title="Add Remarks" variant="secondary" onPress={() => runManufacturingAction('qc_remarks')} style={styles.actionButton} />
          </View>
        )}
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Production Notes</Text>
        <View style={styles.summaryGrid}>
          <SummaryItem label="Fabric Used" value={record?.fabricUsedQty ?? '-'} />
          <SummaryItem label="Fabric Waste" value={record?.fabricWasteQty ?? '-'} />
          <SummaryItem label="Cutting Rejects" value={record?.cuttingRejectQty ?? '-'} />
          <SummaryItem label="Updated" value={formatDateTime(record?.updatedAt || record?.createdAt)} />
        </View>
      </Card>

      <Modal visible={!!manufacturingModal} transparent animationType="slide" onRequestClose={closeManufacturingModal}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeManufacturingModal} />
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.modalTitle}>
              {manufacturingModal === 'cutting_form' ? 'Enter Cutting Results' : manufacturingModal === 'assign_line_form' ? 'Assign to Line' : 'Send to Washing'}
            </Text>
            <Text style={styles.modalSubtitle}>{record?.jobNumber || 'Job'} - {manufacturingLabel(record?.status)}</Text>

            {manufacturingModal === 'cutting_form' && (
              <>
                <TextInput value={manufacturingForm.fabricUsedQty} onChangeText={(v) => updateManufacturingForm('fabricUsedQty', v)} placeholder="Fabric used quantity" placeholderTextColor={colors.muted} keyboardType="numeric" style={styles.noteInputSingle} />
                <TextInput value={manufacturingForm.fabricWasteQty} onChangeText={(v) => updateManufacturingForm('fabricWasteQty', v)} placeholder="Fabric waste quantity" placeholderTextColor={colors.muted} keyboardType="numeric" style={styles.noteInputSingle} />
                <TextInput value={manufacturingForm.totalCutPieces} onChangeText={(v) => updateManufacturingForm('totalCutPieces', v)} placeholder="Total cut pieces" placeholderTextColor={colors.muted} keyboardType="numeric" style={styles.noteInputSingle} />
                <TextInput value={manufacturingForm.cuttingRejectQty} onChangeText={(v) => updateManufacturingForm('cuttingRejectQty', v)} placeholder="Cutting reject quantity" placeholderTextColor={colors.muted} keyboardType="numeric" style={styles.noteInputSingle} />
                <Button title="Save Cutting Results" loading={savingStatus} onPress={submitCuttingResults} />
              </>
            )}

            {manufacturingModal === 'assign_line_form' && (
              <>
                <Text style={styles.label}>Product</Text>
                <View style={styles.statusGrid}>
                  {manufacturingMeta.products.map((product) => (
                    <Pressable key={product._id} onPress={() => updateManufacturingForm('productId', product._id)} style={({ pressed }) => [styles.statusOption, manufacturingForm.productId === product._id && styles.statusOptionSelected, pressed && styles.pressed]}>
                      <Text style={[styles.statusOptionText, manufacturingForm.productId === product._id && styles.statusOptionTextSelected]}>{product.name || product.sku}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.label}>Line</Text>
                <View style={styles.statusGrid}>
                  {manufacturingMeta.lines.map((line) => {
                    const lineName = line.name || line.slug;
                    return (
                      <Pressable key={line._id || lineName} onPress={() => updateManufacturingForm('lineName', lineName)} style={({ pressed }) => [styles.statusOption, manufacturingForm.lineName === lineName && styles.statusOptionSelected, pressed && styles.pressed]}>
                        <Text style={[styles.statusOptionText, manufacturingForm.lineName === lineName && styles.statusOptionTextSelected]}>{lineName}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <TextInput value={manufacturingForm.assignedQuantity} onChangeText={(v) => updateManufacturingForm('assignedQuantity', v)} placeholder="Assigned quantity" placeholderTextColor={colors.muted} keyboardType="numeric" style={styles.noteInputSingle} />
                <TextInput value={manufacturingForm.dispatchDate} onChangeText={(v) => updateManufacturingForm('dispatchDate', v)} placeholder="Dispatch date YYYY-MM-DD" placeholderTextColor={colors.muted} style={styles.noteInputSingle} />
                <Button title="Assign Line" loading={savingStatus} onPress={submitLineAssignment} />
              </>
            )}

            {manufacturingModal === 'washing_form' && (
              <>
                <TextInput value={manufacturingForm.quantitySent} onChangeText={(v) => updateManufacturingForm('quantitySent', v)} placeholder="Quantity sent to washing" placeholderTextColor={colors.muted} keyboardType="numeric" style={styles.noteInputSingle} />
                <TextInput value={manufacturingForm.sentFrom} onChangeText={(v) => updateManufacturingForm('sentFrom', v)} placeholder="Sent from line/section" placeholderTextColor={colors.muted} style={styles.noteInputSingle} />
                <Button title="Create Washing Gate Pass" loading={savingStatus} onPress={submitWashingTransfer} />
              </>
            )}

            <Button title="Cancel" variant="secondary" disabled={savingStatus} onPress={closeManufacturingModal} />
          </View>
        </View>
      </Modal>
    </ScreenScaffold>
  );
}

return (
  <ScreenScaffold title={route.params?.title || titleFor(record)} subtitle="Record detail adapted for mobile review.">
    <Card style={styles.hero}>
      <Text style={styles.title}>{titleFor(record)}</Text>
      <StatusPill value={record?.status || record?.state || record?.role} />
    </Card>
    <Card>
      {detailEntries(record).map(([key, value]) => (
        <View key={key} style={styles.field}>
          <Text style={styles.label}>{readable(key)}</Text>
          <Text style={styles.value}>{String(value)}</Text>
        </View>
      ))}
    </Card>
  </ScreenScaffold>
);
}

function SummaryItem({ label, value }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.summaryValue}>{String(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: 12,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroTitleBlock: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryItem: {
    width: '48%',
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
    padding: 10,
    gap: 4,
  },
  summaryValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
    textTransform: 'capitalize',
  },
  descriptionBox: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    gap: 4,
  },
  updateButton: {
    backgroundColor: colors.success,
  },
  nextActionCard: {
    borderColor: '#bfdbfe',
  },
  nextActionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  nextActionIcon: {
    width: 46,
    height: 46,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  progressBlock: {
    gap: 7,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  stepper: {
    gap: 0,
  },
  stepRow: {
    flexDirection: 'row',
    minHeight: 54,
  },
  stepMarkerWrap: {
    width: 28,
    alignItems: 'center',
  },
  stepMarker: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepMarkerDone: {
    borderColor: colors.success,
    backgroundColor: colors.success,
  },
  stepMarkerActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  stepLine: {
    flex: 1,
    width: 2,
    backgroundColor: colors.border,
  },
  stepLineDone: {
    backgroundColor: colors.success,
  },
  stepContent: {
    flex: 1,
    paddingLeft: 10,
    paddingBottom: 14,
    gap: 2,
  },
  stepTitle: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '800',
  },
  stepTitleDone: {
    color: colors.text,
  },
  stepMeta: {
    color: colors.muted,
    fontSize: 12,
  },
  activityRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  activityDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: colors.primary,
    marginTop: 5,
  },
  activityContent: {
    flex: 1,
    gap: 3,
  },
  activityStatus: {
    color: colors.text,
    fontWeight: '900',
  },
  activityNote: {
    color: colors.muted,
    lineHeight: 19,
  },
  activityDate: {
    color: colors.muted,
    fontSize: 12,
  },
  emptyText: {
    color: colors.muted,
    lineHeight: 20,
  },
  field: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 3,
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  value: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
  },
  bottomSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: colors.surface,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 22,
    gap: 12,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.border,
    marginBottom: 4,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '900',
  },
  modalSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusOption: {
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.chip,
  },
  statusOptionText: {
    color: colors.muted,
    fontWeight: '800',
  },
  statusOptionTextSelected: {
    color: colors.primary,
  },
  noteInput: {
    minHeight: 92,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: 12,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  noteInputSingle: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 12,
    color: colors.text,
    fontSize: 14,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  actionButton: {
    flexGrow: 1,
    minWidth: '46%',
  },
  pressed: {
    opacity: 0.75,
  },
});

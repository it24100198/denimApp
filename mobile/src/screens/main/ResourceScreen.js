import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Button from '../../components/Button';
import Card from '../../components/Card';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import ScreenScaffold from '../../components/ScreenScaffold';
import StatusPill from '../../components/StatusPill';
import { findModuleItem } from '../../navigation/modules';
import { colors } from '../../theme/colors';
import { getId, metricEntries, money, subtitleFor, titleFor, toArray } from '../../utils/dataShape';
import { ROLE_LABELS, ROLES } from '../../utils/roles';
import { approveRegistrationRequest, completeWashingTransfer, getEmployees, getHourlyRecords, getJob, receiveWashingTransfer, rejectRegistrationRequest, saveHourlyProduction, updateAccountSettingsPassword, updateAccountSettingsPreferences, updateAccountSettingsProfile } from '../../api/client';
import { expensesApi, salesApi, stockApi } from '../../api/erp';
import { useAuth } from '../../context/AuthContext';

const readable = (key) => key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ');
const formatRoleLabel = (role) => String(role || '').replace(/_/g, ' ');
const employeeStatus = (employee) => (employee?.userId?.isActive ? 'Active' : 'Inactive');
const employeeEmail = (employee) => employee?.userId?.email || employee?.email || '';
const employeeName = (employee) => employee?.name || employee?.userId?.name || 'Unnamed employee';
const orderStatusLabel = (status) => ({
  confirmed: 'Confirmed',
  in_production: 'In Production',
  cutting: 'Cutting',
  washing: 'Washing',
  qc: 'QC / Final Check',
  packing: 'Packing',
  delivered: 'Delivered',
  delayed: 'Delayed',
}[status] || statusLabel(status));
const expenseStatuses = ['pending', 'approved', 'rejected'];
const requestRoles = [ROLES.EMPLOYEE, ROLES.OPERATOR, ROLES.SUPERVISOR, ROLES.ACCOUNTANT, ROLES.MANAGER, ROLES.ADMIN];
const statusLabel = (value) => String(value || 'pending').replace(/_/g, ' ');
const expenseTitle = (expense) => String(expense?.description || '').split('||')[0]?.trim() || expense?.vendorName || 'Expense';
const expenseCategoryName = (expense) => expense?.category?.name || expense?.category?.title || '-';
const formatMoney = (value) => `Rs. ${Number(value || 0).toLocaleString('en-LK', { maximumFractionDigits: 0 })}`;
const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('en-GB');
};
const getNumber = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
};
const displayValue = (value, fallback = '-') => {
  if (value === null || value === undefined || value === '') return fallback;
  if (['string', 'number', 'boolean'].includes(typeof value)) return String(value);
  if (value instanceof Date) return formatDate(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') {
    return value.name || value.title || value.email || value.fullName || value.jobNumber || value.orderNumber || value.poNumber || value.materialCode || value.supplierId || value._id || fallback;
  }
  return String(value);
};
const pickValue = (record, keys) => {
  for (const key of keys) {
    const value = key.split('.').reduce((acc, part) => acc?.[part], record);
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return undefined;
};
const recordTitle = (record, fallback = 'Record') =>
  displayValue(pickValue(record, ['name', 'title', 'supplier.name', 'material.name', 'items.0.material.name', 'poNumber', 'grnNumber', 'requisitionNumber', 'jobNumber', 'orderNumber', 'productName', 'materialCode', 'sku', 'email']), fallback);
const stockLevel = (qty) => {
  const value = Number(qty || 0);
  if (value <= 10) return { label: 'Low Stock', tone: 'danger' };
  if (value <= 50) return { label: 'Medium Stock', tone: 'warning' };
  return { label: 'High Stock', tone: 'success' };
};
const statusTone = (status) => {
  const text = String(status || '').toLowerCase();
  if (['approved', 'delivered', 'received', 'completed', 'active', 'paid', 'pass', 'good'].includes(text)) return 'success';
  if (['rejected', 'cancelled', 'damaged', 'failed', 'low'].includes(text)) return 'danger';
  if (['pending', 'draft', 'sent', 'partial', 'in_progress'].includes(text)) return 'warning';
  return 'neutral';
};
const isRawMaterialType = (value) => {
  const text = String(value || '').toLowerCase();
  return ['raw', 'material', 'materials', 'fabric', 'accessory', 'accessories', 'production'].some((token) => text.includes(token));
};
const manufacturingSteps = [
  { key: 'FABRIC_ISSUED', label: 'Material Issued' },
  { key: 'CUTTING_COMPLETED', label: 'Cutting Completed' },
  { key: 'LINE_ASSIGNED', label: 'Line Assigned' },
  { key: 'LINE_IN_PROGRESS', label: 'Line In Progress' },
  { key: 'LINE_COMPLETED', label: 'Line Completed' },
  { key: 'WASHING_OUT', label: 'Washing' },
  { key: 'AFTER_WASH_RECEIVED', label: 'QC Pending' },
  { key: 'PACKING_COMPLETED', label: 'QC Passed / Failed' },
  { key: 'WAREHOUSE_RECEIVED', label: 'Completed' },
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
  return manufacturingSteps.find((step) => step.key === status)?.label || statusLabel(status || 'pending');
};
const todayIso = () => new Date().toISOString().slice(0, 10);
const productionHours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const formatHour = (hour) => {
  const value = Number(hour);
  if (value === 0) return '12 AM';
  if (value < 12) return `${value} AM`;
  if (value === 12) return '12 PM';
  return `${value - 12} PM`;
};

export default function ResourceScreen({ route, navigation }) {
  const { signOut, updateUser } = useAuth();
  const { moduleKey, itemKey, title } = route.params || {};
  const item = useMemo(() => findModuleItem(moduleKey, itemKey), [itemKey, moduleKey]);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState('');
  const [reviewModal, setReviewModal] = useState({ type: '', request: null });
  const [approveRole, setApproveRole] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [barcodeQuery, setBarcodeQuery] = useState('');
  const [barcodeResults, setBarcodeResults] = useState([]);
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [accountSaving, setAccountSaving] = useState('');
  const [profileForm, setProfileForm] = useState({ fullName: '', email: '', phone: '', address: '', dateOfBirth: '', profilePhoto: '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [preferencesForm, setPreferencesForm] = useState({ emailNotifications: false, systemAlerts: true, darkMode: false });
  const isEmployeeManagement = moduleKey === 'employees' && itemKey === 'employees';
  const isAccountRequests = moduleKey === 'employees' && itemKey === 'account-requests';
  const isOrdersDashboard = moduleKey === 'orders' && itemKey === 'orders-dashboard';
  const isOrderReport = moduleKey === 'orders' && itemKey === 'order-report';
  const isAllOrders = moduleKey === 'orders' && itemKey === 'all-orders';
  const isExpenseList = moduleKey === 'expenses' && itemKey === 'expenses';
  const isExpenseCategories = moduleKey === 'expenses' && itemKey === 'categories';
  const isRecurringCosts = moduleKey === 'expenses' && itemKey === 'recurring';
  const isFinancialHealth = moduleKey === 'expenses' && itemKey === 'financial-health';
  const isPurchaseModule = moduleKey === 'purchase';
  const isStockModule = moduleKey === 'stock';
  const isManufacturingModule = moduleKey === 'manufacturing';
  const isSalesModule = moduleKey === 'sales';
  const isAiModule = moduleKey === 'ai';
  const isAccountModule = moduleKey === 'account';
  const isStructuredModule = isPurchaseModule || isStockModule || isManufacturingModule;

  const load = useCallback(async () => {
    if (!item?.loader) return;
    setLoading(true);
    setError('');
    try {
      const res = await item.loader();
      setPayload(res?.data ?? res);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Could not load records.');
    } finally {
      setLoading(false);
    }
  }, [item]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (!isAccountModule) return;
    const data = payload?.data ?? payload ?? {};
    setProfileForm({
      fullName: data.fullName || '',
      email: data.email || '',
      phone: data.phone || '',
      address: data.address || '',
      dateOfBirth: data.dateOfBirth ? String(data.dateOfBirth).slice(0, 10) : '',
      profilePhoto: data.profilePhoto || '',
    });
    setPreferencesForm({
      emailNotifications: !!data.preferences?.emailNotifications,
      systemAlerts: data.preferences?.systemAlerts !== false,
      darkMode: !!data.preferences?.darkMode,
    });
  }, [isAccountModule, payload]);

  const records = toArray(payload);
  const metrics = metricEntries(payload);
  const employeeSummary = useMemo(() => {
    if (!isEmployeeManagement) return null;

    const total = records.length;
    const active = records.filter((employee) => !!employee?.userId?.isActive).length;
    return {
      total,
      active,
      inactive: total - active,
    };
  }, [isEmployeeManagement, records]);

  const financialSummary = useMemo(() => {
    if (!isFinancialHealth) return null;

    const data = payload?.data ?? payload ?? {};
    const monthly = Array.isArray(data?.monthly) ? data.monthly : [];
    const totalExpenses = getNumber(data?.yearTotal, data?.totalExpenses, data?.total);
    const rawMaterialCost = monthly.reduce((sum, row) => (
      isRawMaterialType(row?.categoryType || row?.categoryName)
        ? sum + getNumber(row?.total, row?.amount)
        : sum
    ), getNumber(data?.rawMaterialCost, data?.rawMaterialCosts, data?.directMaterialSpend));
    const operationalExpenses = Math.max(0, getNumber(data?.operationalExpenses, totalExpenses - rawMaterialCost));
    const totalIncome = getNumber(data?.totalIncome, data?.income, data?.totalSales, data?.revenue);
    const netExpense = totalIncome > 0 ? totalIncome - totalExpenses : -totalExpenses;
    const status = netExpense > 0 ? 'Balanced' : netExpense < 0 ? (totalIncome > 0 ? 'Loss' : 'Overspent') : 'Balanced';

    return {
      totalExpenses,
      rawMaterialCost,
      operationalExpenses,
      netExpense,
      status,
      hasIncome: totalIncome > 0,
    };
  }, [isFinancialHealth, payload]);

  const orderStats = useMemo(() => {
    if (!isOrdersDashboard && !isOrderReport) return null;
    const data = payload?.data ?? payload ?? {};
    const monthlyStats = Array.isArray(data?.monthlyStats) ? data.monthlyStats : [];
    return {
      total: getNumber(data?.total),
      delivered: getNumber(data?.delivered),
      delayed: getNumber(data?.delayed),
      active: getNumber(data?.active),
      onTimeRate: getNumber(data?.onTimeRate),
      monthlyStats,
    };
  }, [isOrderReport, isOrdersDashboard, payload]);

  const updateProfileField = (key, value) => setProfileForm((prev) => ({ ...prev, [key]: value }));
  const updatePasswordField = (key, value) => setPasswordForm((prev) => ({ ...prev, [key]: value }));
  const updatePreferenceField = (key, value) => setPreferencesForm((prev) => ({ ...prev, [key]: value }));

  const saveAccountProfile = async () => {
    if (!profileForm.fullName.trim()) return Alert.alert('Profile', 'Full name is required.');
    if (!profileForm.email.trim()) return Alert.alert('Profile', 'Email is required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileForm.email.trim())) return Alert.alert('Profile', 'Enter a valid email address.');
    if (!profileForm.phone.trim()) return Alert.alert('Profile', 'Phone number is required.');

    setAccountSaving('profile');
    try {
      const res = await updateAccountSettingsProfile({
        fullName: profileForm.fullName.trim(),
        email: profileForm.email.trim().toLowerCase(),
        phone: profileForm.phone.trim(),
        address: profileForm.address.trim(),
        dateOfBirth: profileForm.dateOfBirth || '',
        profilePhoto: profileForm.profilePhoto.trim(),
      });
      const saved = res?.data?.data || {};
      updateUser?.({ name: saved.fullName || profileForm.fullName, email: saved.email || profileForm.email, phone: saved.phone || profileForm.phone, profilePhoto: saved.profilePhoto || profileForm.profilePhoto });
      Alert.alert('Profile updated', res?.data?.message || 'Profile updated successfully.');
      await load();
    } catch (err) {
      Alert.alert('Profile update failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not update profile.');
    } finally {
      setAccountSaving('');
    }
  };

  const savePassword = async () => {
    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) return Alert.alert('Change password', 'All password fields are required.');
    if (passwordForm.newPassword.length < 8) return Alert.alert('Change password', 'New password must be at least 8 characters.');
    if (passwordForm.newPassword !== passwordForm.confirmPassword) return Alert.alert('Change password', 'Confirm password must match new password.');

    setAccountSaving('password');
    try {
      const res = await updateAccountSettingsPassword(passwordForm);
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      Alert.alert('Password updated', res?.data?.message || 'Password updated successfully.');
    } catch (err) {
      Alert.alert('Password update failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not update password.');
    } finally {
      setAccountSaving('');
    }
  };

  const savePreferences = async () => {
    setAccountSaving('preferences');
    try {
      const res = await updateAccountSettingsPreferences(preferencesForm);
      Alert.alert('Preferences saved', res?.data?.message || 'Preferences updated successfully.');
      await load();
    } catch (err) {
      Alert.alert('Preferences update failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not update preferences.');
    } finally {
      setAccountSaving('');
    }
  };

  const confirmLogout = () => Alert.alert('Logout', 'Sign out of this device?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Logout', style: 'destructive', onPress: signOut },
  ]);

  const toggleEmployeeStatus = async (employee) => {
    if (!item?.updater || !employee?._id) return;

    const nextActive = !employee?.userId?.isActive;
    setUpdatingId(employee._id);
    try {
      await item.updater(employee._id, { isActive: nextActive });
      setPayload((prev) => {
        const list = toArray(prev).map((row) => {
          if (row?._id !== employee._id) return row;
          return {
            ...row,
            userId: {
              ...(row.userId || {}),
              isActive: nextActive,
            },
          };
        });
        return Array.isArray(prev) ? list : { ...prev, items: list, data: Array.isArray(prev?.data) ? list : prev?.data };
      });
      await load();
    } catch (err) {
      Alert.alert('Status update failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not update employee status.');
    } finally {
      setUpdatingId('');
    }
  };

  const openEmployeeEdit = (employee) => {
    navigation.navigate('Form', {
      moduleKey,
      itemKey,
      title: 'Employee',
      mode: 'edit',
      record: employee,
    });
  };

  const renderEmployeeRows = () => (
    <View style={styles.list}>
      {records.map((employee, index) => {
        const active = !!employee?.userId?.isActive;
        const id = getId(employee);
        return (
          <Card key={`${id}-${index}`} style={styles.employeeCard}>
            <View style={styles.employeeHeader}>
              <View style={styles.employeeTitleBlock}>
                <Text style={styles.rowTitle} numberOfLines={1}>{employeeName(employee)}</Text>
                {!!employeeEmail(employee) && <Text style={styles.rowSubtitle} numberOfLines={1}>{employeeEmail(employee)}</Text>}
              </View>
              <View style={[styles.statusBadge, active ? styles.statusActive : styles.statusInactive]}>
                <Text style={[styles.statusText, active ? styles.statusTextActive : styles.statusTextInactive]}>
                  {employeeStatus(employee)}
                </Text>
              </View>
            </View>

            <View style={styles.employeeMetaGrid}>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Role</Text>
                <Text style={styles.metaValue}>{formatRoleLabel(employee?.role)}</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Phone</Text>
                <Text style={styles.metaValue}>{employee?.phone || '-'}</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Section</Text>
                <Text style={styles.metaValue}>{employee?.productionSectionId?.name || '-'}</Text>
              </View>
            </View>

            <View style={styles.employeeActions}>
              <View style={styles.statusToggle}>
                <Text style={styles.metaLabel}>Status</Text>
                <Switch
                  value={active}
                  disabled={updatingId === employee._id}
                  onValueChange={() => toggleEmployeeStatus(employee)}
                  thumbColor={active ? colors.primary : '#f4f4f5'}
                />
              </View>
              <Pressable
                onPress={() => openEmployeeEdit(employee)}
                style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="pencil" size={17} color={colors.primary} />
                <Text style={styles.editButtonText}>Edit</Text>
              </Pressable>
            </View>
          </Card>
        );
      })}
    </View>
  );

  const renderEmployeeSummary = () => {
    if (!employeeSummary) return null;

    return (
      <View style={styles.summaryGrid}>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total Employees</Text>
          <Text style={styles.summaryValue}>{employeeSummary.total}</Text>
        </Card>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Active Employees</Text>
          <Text style={[styles.summaryValue, styles.summaryActive]}>{employeeSummary.active}</Text>
        </Card>
        <Card style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Inactive Employees</Text>
          <Text style={[styles.summaryValue, styles.summaryInactive]}>{employeeSummary.inactive}</Text>
        </Card>
      </View>
    );
  };

  const removeReviewedRequest = (requestId) => {
    setPayload((prev) => {
      const list = toArray(prev).filter((row) => row?._id !== requestId);
      return Array.isArray(prev) ? list : { ...prev, items: list, data: Array.isArray(prev?.data) ? list : prev?.data };
    });
  };

  const openApproveRequest = (request) => {
    setApproveRole('');
    setRejectReason('');
    setReviewModal({ type: 'approve', request });
  };

  const openRejectRequest = (request) => {
    setApproveRole('');
    setRejectReason('');
    setReviewModal({ type: 'reject', request });
  };

  const closeReviewModal = () => {
    if (updatingId) return;
    setReviewModal({ type: '', request: null });
    setApproveRole('');
    setRejectReason('');
  };

  const confirmApproveRequest = async () => {
    const request = reviewModal.request;
    if (!request?._id) return;
    if (!approveRole) {
      Alert.alert('Role required', 'Please select a role before approving this request.');
      return;
    }

    setUpdatingId(request._id);
    try {
      await approveRegistrationRequest(request._id, { role: approveRole });
      removeReviewedRequest(request._id);
      setReviewModal({ type: '', request: null });
      Alert.alert('Request approved', `${request.fullName || 'User'} has been approved.`);
      await load();
    } catch (err) {
      Alert.alert('Approve failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not approve this request.');
    } finally {
      setUpdatingId('');
    }
  };

  const confirmRejectRequest = async () => {
    const request = reviewModal.request;
    const reason = rejectReason.trim();
    if (!request?._id) return;
    if (!reason) {
      Alert.alert('Reason required', 'Please enter a reason before rejecting this request.');
      return;
    }

    setUpdatingId(request._id);
    try {
      await rejectRegistrationRequest(request._id, { rejectionReason: reason });
      removeReviewedRequest(request._id);
      setReviewModal({ type: '', request: null });
      Alert.alert('Request rejected', `${request.fullName || 'User'} has been rejected.`);
      await load();
    } catch (err) {
      Alert.alert('Reject failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not reject this request.');
    } finally {
      setUpdatingId('');
    }
  };

  const renderAccountRequestRows = () => (
    <View style={styles.list}>
      {records.map((request, index) => {
        const id = getId(request);
        const busy = updatingId === request?._id;
        return (
          <Card key={`${id}-${index}`} style={styles.employeeCard}>
            <View style={styles.employeeHeader}>
              <View style={styles.employeeTitleBlock}>
                <Text style={styles.rowTitle} numberOfLines={1}>{request?.fullName || request?.name || 'Pending user'}</Text>
                {!!request?.email && <Text style={styles.rowSubtitle} numberOfLines={1}>{request.email}</Text>}
              </View>
              <View style={[styles.statusBadge, styles.expenseStatus_pending]}>
                <Text style={[styles.statusText, styles.expenseStatusText_pending]}>
                  {statusLabel(request?.status || 'pending')}
                </Text>
              </View>
            </View>

            <View style={styles.employeeMetaGrid}>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Phone</Text>
                <Text style={styles.metaValue}>{request?.phoneNumber || '-'}</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Date</Text>
                <Text style={styles.metaValue}>{formatDate(request?.createdAt)}</Text>
              </View>
            </View>

            {!!request?.reasonForAccess && (
              <Text style={styles.requestReason} numberOfLines={3}>{request.reasonForAccess}</Text>
            )}

            <View style={styles.requestActions}>
              <Pressable
                disabled={busy}
                onPress={() => openApproveRequest(request)}
                style={({ pressed }) => [styles.reviewButton, styles.approveButton, (pressed || busy) && styles.pressed]}
              >
                <MaterialCommunityIcons name="check-circle-outline" size={18} color="#fff" />
                <Text style={styles.reviewButtonText}>Approve</Text>
              </Pressable>
              <Pressable
                disabled={busy}
                onPress={() => openRejectRequest(request)}
                style={({ pressed }) => [styles.reviewButton, styles.rejectButton, (pressed || busy) && styles.pressed]}
              >
                <MaterialCommunityIcons name="close-circle-outline" size={18} color="#fff" />
                <Text style={styles.reviewButtonText}>Reject</Text>
              </Pressable>
            </View>
          </Card>
        );
      })}
    </View>
  );

  const openOrderDetail = (order) => {
    navigation.navigate('Detail', {
      moduleKey,
      itemKey,
      title: order?.orderNumber || 'Order Details',
      record: order,
    });
  };

  const deleteOrder = (order) => {
    if (!item?.remover || !order?._id) return;

    Alert.alert('Delete order', `Are you sure you want to delete ${order.orderNumber || 'this order'}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setUpdatingId(order._id);
          try {
            await item.remover(order._id);
            setPayload((prev) => {
              const list = toArray(prev).filter((row) => row?._id !== order._id);
              return Array.isArray(prev) ? list : { ...prev, orders: list, items: list, data: Array.isArray(prev?.data) ? list : prev?.data };
            });
          } catch (err) {
            Alert.alert('Delete failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not delete order.');
          } finally {
            setUpdatingId('');
          }
        },
      },
    ]);
  };

  const renderOrderRows = () => (
    <View style={styles.list}>
      {records.map((order, index) => {
        const id = getId(order);
        const progress = Number(order?.completionPercentage || 0);
        return (
          <Card key={`${id}-${index}`} style={styles.employeeCard}>
            <View style={styles.employeeHeader}>
              <View style={styles.employeeTitleBlock}>
                <Text style={styles.rowTitle} numberOfLines={1}>{order?.orderNumber || 'Order'}</Text>
                <Text style={styles.rowSubtitle} numberOfLines={1}>{order?.customerName || '-'}</Text>
              </View>
              <View style={[styles.statusBadge, order?.status === 'delivered' ? styles.statusActive : styles.expenseStatus_pending]}>
                <Text style={[styles.statusText, order?.status === 'delivered' ? styles.statusTextActive : styles.expenseStatusText_pending]}>
                  {orderStatusLabel(order?.status || 'confirmed')}
                </Text>
              </View>
            </View>

            <View style={styles.employeeMetaGrid}>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Quantity</Text>
                <Text style={styles.metaValue}>{order?.quantity || 0}</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Confirmed</Text>
                <Text style={styles.metaValue}>{formatDate(order?.confirmedDate || order?.createdAt)}</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Expected</Text>
                <Text style={styles.metaValue}>{formatDate(order?.expectedDeliveryDate)}</Text>
              </View>
            </View>

            <View style={styles.progressBlock}>
              <View style={styles.progressHeader}>
                <Text style={styles.metaLabel}>Completion Progress</Text>
                <Text style={styles.progressText}>{Math.max(0, Math.min(100, progress))}%</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, progress))}%` }]} />
              </View>
            </View>

            <View style={styles.employeeActions}>
              <Pressable
                onPress={() => openOrderDetail(order)}
                style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="eye-outline" size={17} color={colors.primary} />
                <Text style={styles.editButtonText}>View</Text>
              </Pressable>
              <Pressable
                onPress={() => deleteOrder(order)}
                disabled={updatingId === order._id}
                style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="trash-can-outline" size={17} color={colors.danger} />
                <Text style={styles.deleteButtonText}>Delete</Text>
              </Pressable>
            </View>
          </Card>
        );
      })}
    </View>
  );

  const renderOrderDashboardCard = ({ cardKey, title: cardTitle, value, subtitle, icon, tone, suffix = '' }) => (
    <Card key={cardKey} style={[styles.orderKpiCard, styles[`orderKpi_${tone}`]]}>
      <View style={[styles.orderKpiIcon, styles[`orderKpiIcon_${tone}`]]}>
        <MaterialCommunityIcons name={icon} size={22} color="#fff" />
      </View>
      <Text style={styles.orderKpiLabel}>{cardTitle}</Text>
      <Text style={styles.orderKpiValue}>{value}{suffix}</Text>
      <Text style={styles.orderKpiSubtitle}>{subtitle}</Text>
    </Card>
  );

  const renderOrdersDashboard = () => {
    if (!orderStats) return null;

    return (
      <View style={styles.orderDashboard}>
        <View style={styles.orderHero}>
          <Text style={styles.financialEyebrow}>Orders Dashboard</Text>
          <Text style={styles.financialTitle}>Order Performance Overview</Text>
          <Text style={styles.financialSubtitle}>Track order totals, delivery health, active workload, and on-time performance.</Text>
        </View>
        <View style={styles.kpiGrid}>
          {renderOrderDashboardCard({
            title: 'Total Orders',
            value: orderStats.total,
            subtitle: 'All customer orders',
            icon: 'clipboard-list-outline',
            tone: 'neutral',
          })}
          {renderOrderDashboardCard({
            title: 'Delivered Orders',
            value: orderStats.delivered,
            subtitle: 'Completed deliveries',
            icon: 'check-circle-outline',
            tone: 'success',
          })}
          {renderOrderDashboardCard({
            title: 'Delayed Orders',
            value: orderStats.delayed,
            subtitle: 'Needs attention',
            icon: 'alert-circle-outline',
            tone: 'danger',
          })}
          {renderOrderDashboardCard({
            title: 'Active Orders',
            value: orderStats.active,
            subtitle: 'Currently in workflow',
            icon: 'progress-clock',
            tone: 'primary',
          })}
          {renderOrderDashboardCard({
            title: 'On Time Rate',
            value: orderStats.onTimeRate,
            suffix: '%',
            subtitle: 'Delivered on schedule',
            icon: 'timer-check-outline',
            tone: 'neutral',
          })}
        </View>
      </View>
    );
  };

  const renderOrderReport = () => {
    if (!orderStats) return null;

    return (
      <View style={styles.orderDashboard}>
        <View style={styles.orderHero}>
          <Text style={styles.financialEyebrow}>Order Report</Text>
          <Text style={styles.financialTitle}>Monthly Order Summary</Text>
          <Text style={styles.financialSubtitle}>Clean monthly cards for total, delivered, pending, and completion rate.</Text>
        </View>
        {orderStats.monthlyStats.length ? (
          <View style={styles.list}>
            {orderStats.monthlyStats.map((month, index) => {
              const total = getNumber(month?.total);
              const delivered = getNumber(month?.delivered);
              const pending = Math.max(0, total - delivered);
              const completionRate = total > 0 ? Math.round((delivered / total) * 100) : 0;
              return (
                <Card key={`${month?.label || 'month'}-${index}`} style={styles.monthCard}>
                  <View style={styles.monthHeader}>
                    <View>
                      <Text style={styles.monthLabel}>Month</Text>
                      <Text style={styles.monthTitle}>{month?.label || '-'}</Text>
                    </View>
                    <View style={styles.monthRateBadge}>
                      <Text style={styles.monthRateText}>{completionRate}%</Text>
                    </View>
                  </View>

                  <View style={styles.reportGrid}>
                    <View style={styles.reportItem}>
                      <Text style={styles.metaLabel}>Total Orders</Text>
                      <Text style={styles.reportValue}>{total}</Text>
                    </View>
                    <View style={styles.reportItem}>
                      <Text style={styles.metaLabel}>Delivered Orders</Text>
                      <Text style={[styles.reportValue, styles.summaryActive]}>{delivered}</Text>
                    </View>
                    <View style={styles.reportItem}>
                      <Text style={styles.metaLabel}>Pending Orders</Text>
                      <Text style={[styles.reportValue, styles.orderPrimaryText]}>{pending}</Text>
                    </View>
                    <View style={styles.reportItem}>
                      <Text style={styles.metaLabel}>Completion Rate</Text>
                      <Text style={styles.reportValue}>{completionRate}%</Text>
                    </View>
                  </View>

                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${completionRate}%` }]} />
                  </View>
                </Card>
              );
            })}
          </View>
        ) : (
          <EmptyState />
        )}
      </View>
    );
  };

  const openRecordDetail = (record) => {
    navigation.navigate('Detail', { moduleKey, itemKey, title: recordTitle(record, item?.title), record });
  };

  const openRecordEdit = (record) => {
    navigation.navigate('Form', {
      moduleKey,
      itemKey,
      title: item?.title || 'Record',
      mode: 'edit',
      record,
    });
  };

  const deleteRecord = (record) => {
    if (!item?.remover || !record?._id) return;

    Alert.alert('Delete record', `Are you sure you want to delete ${recordTitle(record, 'this record')}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setUpdatingId(record._id);
          try {
            await item.remover(record._id);
            setPayload((prev) => {
              const list = toArray(prev).filter((row) => row?._id !== record._id);
              return Array.isArray(prev) ? list : { ...prev, items: list, data: Array.isArray(prev?.data) ? list : prev?.data };
            });
          } catch (err) {
            Alert.alert('Delete failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not delete this record.');
          } finally {
            setUpdatingId('');
          }
        },
      },
    ]);
  };

  const renderStatusBadge = (value, extraStyle) => {
    const tone = statusTone(value);
    return (
      <View style={[styles.moduleBadge, styles[`moduleBadge_${tone}`], extraStyle]}>
        <Text style={[styles.moduleBadgeText, styles[`moduleBadgeText_${tone}`]]}>{statusLabel(value || 'open')}</Text>
      </View>
    );
  };

  const fieldSetForRecord = (record) => {
    if (isPurchaseModule && itemKey === 'suppliers') {
      return [
        ['Contact', pickValue(record, ['contactPerson', 'phone', 'contactInfo'])],
        ['Email', record?.email],
        ['Address', record?.address],
      ];
    }
    if (isPurchaseModule && itemKey === 'materials') {
      return [
        ['Category', record?.category],
        ['Unit Price', record?.unitPrice !== undefined ? formatMoney(record.unitPrice) : undefined],
        ['Stock Qty', pickValue(record, ['currentStock', 'stockQuantity', 'stockQty'])],
      ];
    }
    if (isPurchaseModule && itemKey === 'requisitions') {
      return [
        ['Requested By', pickValue(record, ['requestedBy.name', 'requestedBy', 'section'])],
        ['Items', record?.items],
        ['Required Date', pickValue(record, ['requiredDate', 'expectedDeliveryDate', 'createdAt']) ? formatDate(pickValue(record, ['requiredDate', 'expectedDeliveryDate', 'createdAt'])) : undefined],
      ];
    }
    if (isPurchaseModule && itemKey === 'purchase-orders') {
      return [
        ['Supplier', pickValue(record, ['supplier.name', 'supplier'])],
        ['Items', record?.items],
        ['Total', record?.grandTotal !== undefined ? formatMoney(record.grandTotal) : record?.totalAmount !== undefined ? formatMoney(record.totalAmount) : undefined],
      ];
    }
    if (isPurchaseModule && itemKey === 'grn') {
      return [
        ['PO Reference', pickValue(record, ['purchaseOrder.poNumber', 'purchaseOrder'])],
        ['Received Date', formatDate(pickValue(record, ['receivedDate', 'createdAt']))],
        ['Items', record?.items],
      ];
    }
    if (isStockModule && itemKey === 'products') {
      return [
        ['SKU', record?.sku],
        ['Classification', record?.classification],
        ['Stock Qty', pickValue(record, ['stockQty', 'quantity', 'currentStock'])],
      ];
    }
    if (isStockModule && itemKey === 'adjustments') {
      return [
        ['Material', pickValue(record, ['material.name', 'material'])],
        ['Type', pickValue(record, ['adjustmentType', 'type'])],
        ['Quantity', pickValue(record, ['quantity', 'qty'])],
      ];
    }
    if (isStockModule && itemKey === 'issuance') {
      return [
        ['Material', pickValue(record, ['material.name', 'material'])],
        ['Issued To', record?.issuedTo],
        ['Quantity', pickValue(record, ['quantity', 'qty'])],
      ];
    }
    if (isStockModule && itemKey === 'history') {
      return [
        ['Movement', pickValue(record, ['movementType', 'type', 'action'])],
        ['Quantity', pickValue(record, ['quantity', 'qty'])],
        ['Date', formatDate(pickValue(record, ['createdAt', 'date', 'timestamp']))],
      ];
    }
    if (isManufacturingModule) {
      return [
        ['Status', record?.status],
        ['Quantity', pickValue(record, ['quantity', 'qty', 'targetQty', 'completedQty'])],
        ['Date', formatDate(pickValue(record, ['createdAt', 'date', 'updatedAt']))],
      ];
    }
    return [
      ['Status', record?.status || record?.state],
      ['Date', formatDate(record?.createdAt || record?.date)],
      ['Items', record?.items],
    ];
  };

  const renderPurchaseStepper = (status) => {
    const stages = ['created', 'approved', 'delivered'];
    const current = String(status || 'created').toLowerCase();
    const aliases = { draft: 'created', sent: 'approved', received: 'delivered' };
    const normalized = aliases[current] || current;
    const currentIndex = Math.max(0, stages.indexOf(normalized));
    return (
      <View style={styles.compactStepper}>
        {stages.map((stage, index) => {
          const done = index <= currentIndex;
          return (
            <View key={stage} style={styles.compactStep}>
              <View style={[styles.compactStepDot, done && styles.compactStepDotDone]} />
              <Text style={[styles.compactStepText, done && styles.compactStepTextDone]}>{statusLabel(stage)}</Text>
            </View>
          );
        })}
      </View>
    );
  };

  const manufacturingRecords = () => {
    const data = payload?.data ?? payload;
    if (itemKey === 'washing' && data && typeof data === 'object' && !Array.isArray(data)) {
      return [
        ...(Array.isArray(data.incomingPending) ? data.incomingPending.map((row) => ({ ...row, gateGroup: 'Pending Gate Pass' })) : []),
        ...(Array.isArray(data.inProgressReceived) ? data.inProgressReceived.map((row) => ({ ...row, gateGroup: 'Washing In Progress' })) : []),
        ...(Array.isArray(data.completedWashing) ? data.completedWashing.map((row) => ({ ...row, gateGroup: 'Completed Washing' })) : []),
        ...(Array.isArray(data.returned) ? data.returned.map((row) => ({ ...row, gateGroup: 'Returned' })) : []),
      ];
    }
    return records;
  };

  const renderManufacturingTimelineMini = (status) => {
    const current = manufacturingOrder[status] ?? 0;
    return (
      <View style={styles.mfgMiniTimeline}>
        {manufacturingSteps.map((step, index) => {
          const done = index < current || status === 'WAREHOUSE_RECEIVED';
          const active = Math.floor(current) === index && status !== 'WAREHOUSE_RECEIVED';
          return (
            <View key={step.key} style={styles.mfgMiniStep}>
              <View style={[styles.mfgMiniDot, done && styles.mfgMiniDotDone, active && styles.mfgMiniDotActive]} />
              <Text numberOfLines={2} style={[styles.mfgMiniText, (done || active) && styles.mfgMiniTextActive]}>{step.label}</Text>
            </View>
          );
        })}
      </View>
    );
  };

  const handleGatePassAction = async (transfer, action) => {
    if (!transfer?._id) return;
    if (action === 'reject') {
      Alert.alert('Reject gate pass', 'Reject reason capture can be connected when backend reject endpoint is available.');
      return;
    }

    setUpdatingId(transfer._id);
    try {
      if (transfer.status === 'pending') {
        await receiveWashingTransfer(transfer._id);
        Alert.alert('Approved', 'Gate pass received for washing.');
      } else if (transfer.status === 'received') {
        await completeWashingTransfer(transfer._id);
        Alert.alert('Completed', 'Washing marked as completed.');
      } else {
        Alert.alert('No action needed', 'This gate pass is already processed.');
      }
      await load();
    } catch (err) {
      Alert.alert('Gate pass update failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not update gate pass.');
    } finally {
      setUpdatingId('');
    }
  };

  const renderManufacturingDashboard = () => {
    const data = payload?.data ?? payload ?? {};
    const kpis = data?.kpis || data;
    const recentJobs = Array.isArray(data?.recentJobs) ? data.recentJobs : Array.isArray(data?.jobs) ? data.jobs : [];
    const dashboardCards = [
      ['Total Jobs', kpis?.totalJobs ?? recentJobs.length, 'factory', 'neutral'],
      ['Fabric / Cutting', kpis?.fabricCutting ?? 0, 'content-cut', 'primary'],
      ['Line Assigned', kpis?.lineAssigned ?? recentJobs.filter((job) => String(job.status || '').includes('LINE')).length, 'account-switch-outline', 'success'],
      ['Washing', kpis?.washing ?? 0, 'washing-machine', 'primary'],
      ['Delayed Jobs', kpis?.delayedJobs ?? kpis?.delayed ?? 0, 'alert-circle-outline', 'danger'],
      ['Efficiency', kpis?.efficiency ?? kpis?.efficiencyPercent ?? 0, 'speedometer', 'success'],
    ];

    return (
      <View style={styles.orderDashboard}>
        <View style={styles.orderHero}>
          <Text style={styles.financialEyebrow}>{itemKey === 'supervisor' ? 'Supervisor Dashboard' : 'Manufacturing Dashboard'}</Text>
          <Text style={styles.financialTitle}>{itemKey === 'supervisor' ? 'Line Performance Overview' : 'Production Workflow Overview'}</Text>
          <Text style={styles.financialSubtitle}>Hourly production, efficiency, delayed work, and current manufacturing flow in a readable mobile layout.</Text>
        </View>
        <View style={styles.kpiGrid}>
          {dashboardCards.map(([cardTitle, value, icon, tone]) => renderOrderDashboardCard({
            cardKey: cardTitle,
            title: cardTitle,
            value: money(value),
            subtitle: cardTitle === 'Efficiency' ? 'Current efficiency %' : 'Live count',
            icon,
            tone,
          }))}
        </View>
        {!!recentJobs.length && (
          <Card style={styles.monthCard}>
            <Text style={styles.sectionTitle}>Worker Performance / Recent Jobs</Text>
            {recentJobs.slice(0, 5).map((job, index) => (
              <View key={`${job?._id || index}`} style={styles.compactRow}>
                <Text style={styles.compactRowTitle}>{recordTitle(job, 'Job')}</Text>
                <Text style={styles.compactRowMeta}>{manufacturingLabel(job?.status)}</Text>
              </View>
            ))}
          </Card>
        )}
      </View>
    );
  };

  const renderManufacturingRows = () => {
    if (itemKey === 'hourly') {
      navigation.replace('HourlyProduction');
      return <LoadingState />;
    }
    if (['overview', 'supervisor'].includes(itemKey)) return renderManufacturingDashboard();
    const list = manufacturingRecords();
    if (!list.length) return <EmptyState />;

    return (
      <View style={styles.list}>
        {list.map((record, index) => {
          const id = getId(record);
          const isGatePass = itemKey === 'washing';
          const status = record?.status || record?.jobId?.status;
          const titleText = record?.jobNumber || record?.jobId?.jobNumber || recordTitle(record, item?.title);
          return (
            <Card key={`${id}-${index}`} style={styles.moduleCard}>
              <View style={styles.employeeHeader}>
                <View style={styles.employeeTitleBlock}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{titleText}</Text>
                  <Text style={styles.rowSubtitle} numberOfLines={2}>
                    {isGatePass ? `${record?.gateGroup || 'Gate Pass'} - Qty ${record?.quantitySent ?? '-'}` : record?.productId?.name || record?.styleRef || record?.batchRef || 'Manufacturing job'}
                  </Text>
                </View>
                {renderStatusBadge(isGatePass ? record?.status : manufacturingLabel(status))}
              </View>

              <View style={styles.employeeMetaGrid}>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>{isGatePass ? 'Quantity Sent' : 'Issued Fabric'}</Text>
                  <Text style={styles.metaValue}>{isGatePass ? record?.quantitySent ?? '-' : record?.issuedFabricQuantity ?? '-'}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>{isGatePass ? 'Sent From' : 'Current Step'}</Text>
                  <Text style={styles.metaValue}>{isGatePass ? record?.sentFrom || '-' : manufacturingLabel(status)}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>Date</Text>
                  <Text style={styles.metaValue}>{formatDate(record?.createdAt || record?.issueDate)}</Text>
                </View>
              </View>

              {!isGatePass && renderManufacturingTimelineMini(status)}

              <View style={styles.employeeActions}>
                <Pressable onPress={() => openRecordDetail(isGatePass ? record?.jobId || record : record)} style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
                  <MaterialCommunityIcons name="eye-outline" size={17} color={colors.primary} />
                  <Text style={styles.editButtonText}>View</Text>
                </Pressable>
                {isGatePass ? (
                  <>
                    <Pressable disabled={updatingId === record._id} onPress={() => handleGatePassAction(record, 'approve')} style={({ pressed }) => [styles.approveSmallButton, pressed && styles.pressed]}>
                      <Text style={styles.approveSmallText}>Approve</Text>
                    </Pressable>
                    <Pressable disabled={updatingId === record._id} onPress={() => handleGatePassAction(record, 'reject')} style={({ pressed }) => [styles.rejectSmallButton, pressed && styles.pressed]}>
                      <Text style={styles.rejectSmallText}>Reject</Text>
                    </Pressable>
                  </>
                ) : itemKey === 'qc' ? (
                  <Pressable onPress={() => navigation.navigate('QualityControl', { transferId: record._id })} style={({ pressed }) => [styles.approveSmallButton, pressed && styles.pressed, { backgroundColor: colors.primary }]}>
                    <MaterialCommunityIcons name="clipboard-check-outline" size={16} color="#fff" style={{ marginRight: 6 }} />
                    <Text style={styles.approveSmallText}>Open QC Board</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={() => openRecordDetail(record)} style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
                    <MaterialCommunityIcons name="timeline-clock-outline" size={17} color={colors.primary} />
                    <Text style={styles.editButtonText}>Timeline</Text>
                  </Pressable>
                )}
              </View>
            </Card>
          );
        })}
      </View>
    );
  };

  const salesStatusOptions = () => ({
    quotations: ['draft', 'sent', 'approved', 'rejected', 'converted'],
    'sales-orders': ['pending', 'confirmed', 'processing', 'dispatched', 'delivered', 'cancelled'],
    invoices: ['unpaid', 'partial', 'paid'],
    delivery: ['pending', 'packed', 'shipped', 'delivered'],
    returns: ['pending', 'approved', 'rejected', 'completed'],
  }[itemKey] || []);

  const salesRecordNumber = (record) =>
    record?.quoteNumber || record?.orderNumber || record?.invoiceNumber || record?.doNumber || record?.rmaNumber || recordTitle(record, item?.title);

  const salesTotal = (record) => {
    if (record?.totalAmount !== undefined) return formatMoney(record.totalAmount);
    const items = Array.isArray(record?.items) ? record.items : [];
    const total = items.reduce((sum, row) => sum + getNumber(row?.totalPrice, Number(row?.qty || 0) * Number(row?.unitPrice || 0)), 0);
    return total ? formatMoney(total) : '-';
  };

  const changeSalesStatus = async (record, status) => {
    if (!record?._id || record.status === status) return;
    setUpdatingId(record._id);
    try {
      if (itemKey === 'returns') {
        if (status === 'approved' || status === 'completed') {
          await salesApi.approveReturn(record._id, { approvedBy: 'Manager', reviewNote: 'Approved from mobile app' });
        } else if (status === 'rejected') {
          await salesApi.rejectReturn(record._id, { approvedBy: 'Manager', reviewNote: 'Rejected from mobile app' });
        }
      } else if (item?.updater) {
        if (itemKey === 'invoices') {
          Alert.alert('Payment update', 'Use invoice payment recording to change paid/partial status.');
          return;
        }
        await item.updater(record._id, { status });
      }
      setPayload((prev) => {
        const list = toArray(prev).map((row) => (row?._id === record._id ? { ...row, status } : row));
        return Array.isArray(prev) ? list : { ...prev, items: list, data: Array.isArray(prev?.data) ? list : prev?.data };
      });
      await load();
    } catch (err) {
      Alert.alert('Status update failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not update status.');
    } finally {
      setUpdatingId('');
    }
  };

  const renderSalesAnalytics = () => {
    const data = payload?.data ?? payload ?? {};
    const monthly = Array.isArray(data.monthlyRevenue) ? data.monthlyRevenue : [];
    const topItems = Array.isArray(data.topItems) ? data.topItems : [];
    const orderCounts = Array.isArray(data.orderCounts) ? data.orderCounts : [];
    const pendingOrders = orderCounts.find((row) => row?._id === 'pending')?.count || 0;
    const maxRevenue = Math.max(1, ...monthly.map((row) => getNumber(row?.revenue)));

    return (
      <View style={styles.orderDashboard}>
        <View style={styles.orderHero}>
          <Text style={styles.financialEyebrow}>Sales Analytics</Text>
          <Text style={styles.financialTitle}>Sales Insights</Text>
          <Text style={styles.financialSubtitle}>Revenue, pending orders, outstanding payments, and top selling items.</Text>
        </View>
        <View style={styles.kpiGrid}>
          {renderOrderDashboardCard({ cardKey: 'revenue', title: 'Total Sales', value: formatMoney(data.totalRevenue), subtitle: 'Invoice revenue', icon: 'cash-multiple', tone: 'success' })}
          {renderOrderDashboardCard({ cardKey: 'pending', title: 'Pending Orders', value: pendingOrders, subtitle: 'Awaiting workflow', icon: 'clock-outline', tone: 'warning' })}
          {renderOrderDashboardCard({ cardKey: 'paid', title: 'Revenue Paid', value: formatMoney(data.totalPaid), subtitle: 'Collected amount', icon: 'check-circle-outline', tone: 'primary' })}
          {renderOrderDashboardCard({ cardKey: 'outstanding', title: 'Outstanding', value: formatMoney(data.totalOutstanding), subtitle: 'Unpaid balance', icon: 'alert-circle-outline', tone: 'danger' })}
        </View>
        <Card style={styles.monthCard}>
          <Text style={styles.sectionTitle}>Monthly Revenue</Text>
          {monthly.length ? monthly.map((row) => {
            const width = `${Math.max(5, Math.round((getNumber(row.revenue) / maxRevenue) * 100))}%`;
            return (
              <View key={row._id} style={styles.chartRow}>
                <Text style={styles.chartLabel}>Month {row._id}</Text>
                <View style={styles.chartTrack}><View style={[styles.chartBar, { width }]} /></View>
                <Text style={styles.chartValue}>{formatMoney(row.revenue)}</Text>
              </View>
            );
          }) : <Text style={styles.emptyText}>No monthly revenue yet.</Text>}
        </Card>
        <Card style={styles.monthCard}>
          <Text style={styles.sectionTitle}>Top Selling Items</Text>
          {topItems.length ? topItems.slice(0, 6).map((row) => (
            <View key={row._id} style={styles.compactRow}>
              <Text style={styles.compactRowTitle}>{row._id || 'Item'}</Text>
              <Text style={styles.compactRowMeta}>{row.totalQty} pcs - {formatMoney(row.totalRevenue)}</Text>
            </View>
          )) : <Text style={styles.emptyText}>No top items yet.</Text>}
        </Card>
        <Card style={styles.monthCard}>
          <Text style={styles.sectionTitle}>Order Status Mix</Text>
          {orderCounts.length ? orderCounts.map((row) => (
            <View key={row._id} style={styles.statusMixRow}>
              {renderStatusBadge(row._id)}
              <Text style={styles.statusMixValue}>{row.count} orders</Text>
            </View>
          )) : <Text style={styles.emptyText}>No order status data yet.</Text>}
        </Card>
      </View>
    );
  };

  const renderSalesRows = () => {
    if (itemKey === 'sales-analytics') return renderSalesAnalytics();
    if (!records.length) return <EmptyState />;
    const statusOptions = salesStatusOptions();

    return (
      <View style={styles.list}>
        <Text style={styles.sectionTitle}>Open Records</Text>
        {records.map((record, index) => (
          <Card key={`${getId(record)}-${index}`} style={styles.moduleCard}>
            <View style={styles.employeeHeader}>
              <View style={styles.employeeTitleBlock}>
                <Text style={styles.rowTitle} numberOfLines={1}>{salesRecordNumber(record)}</Text>
                <Text style={styles.rowSubtitle} numberOfLines={2}>{record?.customer?.name || record?.salesOrder?.orderNumber || 'Sales record'}</Text>
              </View>
              {renderStatusBadge(record?.paymentStatus || record?.status || 'open')}
            </View>
            <View style={styles.employeeMetaGrid}>
              <View style={styles.metaItem}><Text style={styles.metaLabel}>Total</Text><Text style={styles.metaValue}>{salesTotal(record)}</Text></View>
              <View style={styles.metaItem}><Text style={styles.metaLabel}>Items</Text><Text style={styles.metaValue}>{Array.isArray(record?.items) ? record.items.length : '-'}</Text></View>
              <View style={styles.metaItem}><Text style={styles.metaLabel}>Date</Text><Text style={styles.metaValue}>{formatDate(record?.createdAt || record?.validUntil || record?.dueDate)}</Text></View>
            </View>
            {!!statusOptions.length && (
              <View style={styles.statusActions}>
                {statusOptions.slice(0, 6).map((status) => (
                  <Pressable
                    key={status}
                    disabled={updatingId === record._id || record.status === status || record.paymentStatus === status}
                    onPress={() => changeSalesStatus(record, status)}
                    style={({ pressed }) => [styles.statusActionButton, (record.status === status || record.paymentStatus === status) && styles.statusActionActive, pressed && styles.pressed]}
                  >
                    <Text style={[styles.statusActionText, (record.status === status || record.paymentStatus === status) && styles.statusActionTextActive]}>{statusLabel(status)}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={styles.employeeActions}>
              <Pressable onPress={() => openRecordDetail(record)} style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
                <MaterialCommunityIcons name="eye-outline" size={17} color={colors.primary} />
                <Text style={styles.editButtonText}>View</Text>
              </Pressable>
              {!!item?.updater && (
                <Pressable onPress={() => openRecordEdit(record)} style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
                  <MaterialCommunityIcons name="pencil" size={17} color={colors.primary} />
                  <Text style={styles.editButtonText}>Edit</Text>
                </Pressable>
              )}
              {!!item?.remover && (
                <Pressable disabled={updatingId === record._id} onPress={() => deleteRecord(record)} style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}>
                  <MaterialCommunityIcons name="trash-can-outline" size={17} color={colors.danger} />
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </Pressable>
              )}
            </View>
          </Card>
        ))}
      </View>
    );
  };

  const renderStockDashboard = () => {
    const data = payload?.data ?? payload ?? {};
    const cards = [
      ['Total Items', data.totalItemsAll ?? data.totalItems ?? 0, 'package-variant-closed', 'primary'],
      ['Inventory Value', formatMoney(data.totalValue ?? 0), 'cash-multiple', 'success'],
      ['Low Stock', data.lowStock ?? 0, 'alert-circle-outline', 'warning'],
      ['Out of Stock', data.outOfStock ?? 0, 'close-circle-outline', 'danger'],
    ];
    const recentMovements = Array.isArray(data.recentMovements) ? data.recentMovements : [];

    return (
      <View style={styles.orderDashboard}>
        <View style={styles.orderHero}>
          <Text style={styles.financialEyebrow}>Inventory Dashboard</Text>
          <Text style={styles.financialTitle}>Stock Overview</Text>
          <Text style={styles.financialSubtitle}>Inventory value, stock alerts, and recent movement activity.</Text>
        </View>
        <View style={styles.kpiGrid}>
          {cards.map(([cardTitle, value, icon, tone]) => renderOrderDashboardCard({
            cardKey: cardTitle,
            title: cardTitle,
            value,
            subtitle: 'Live stock metric',
            icon,
            tone,
          }))}
        </View>
        <Card style={styles.monthCard}>
          <Text style={styles.sectionTitle}>Recent Stock Movements</Text>
          {recentMovements.length ? recentMovements.map((movement) => (
            <View key={movement._id} style={styles.timelineLine}>
              <View style={[styles.timelineDot, Number(movement.quantity) < 0 && styles.timelineDotDanger]} />
              <View style={styles.employeeTitleBlock}>
                <Text style={styles.compactRowTitle}>{movement.material?.name || 'Material'}</Text>
                <Text style={styles.compactRowMeta}>{statusLabel(movement.movementType)} - {movement.quantity} {movement.material?.uom || ''}</Text>
              </View>
            </View>
          )) : <Text style={styles.emptyText}>No recent movements.</Text>}
        </Card>
      </View>
    );
  };

  const runBarcodeLookup = async () => {
    const query = barcodeQuery.trim();
    if (!query) {
      Alert.alert('Barcode lookup', 'Enter or scan a product/material code.');
      return;
    }
    setBarcodeLoading(true);
    try {
      const results = await stockApi.barcodeLookup(query);
      setBarcodeResults(Array.isArray(results) ? results : results?.data || []);
    } catch (err) {
      Alert.alert('Lookup failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not fetch product details.');
    } finally {
      setBarcodeLoading(false);
    }
  };

  const renderBarcodeScanner = () => (
    <View style={styles.orderDashboard}>
      <View style={styles.scannerPanel}>
        <MaterialCommunityIcons name="barcode-scan" size={46} color="#fff" />
        <Text style={styles.scannerTitle}>Scan Product Barcode</Text>
        <Text style={styles.scannerSubtitle}>Camera scanner UI is ready. Enter code/name below to auto fetch product details.</Text>
        <View style={styles.scannerFrame} />
      </View>
      <Card style={styles.monthCard}>
        <Text style={styles.sectionTitle}>Barcode / Product Lookup</Text>
        <TextInput
          value={barcodeQuery}
          onChangeText={setBarcodeQuery}
          placeholder="Scan or enter product/material code"
          placeholderTextColor={colors.muted}
          style={styles.lookupInput}
        />
        <Button title="Fetch Product Details" loading={barcodeLoading} onPress={runBarcodeLookup} />
      </Card>
      <View style={styles.list}>
        {barcodeResults.map((record, index) => {
          const level = stockLevel(record?.currentStock ?? record?.stockQty ?? 0);
          return (
            <Card key={`${getId(record)}-${index}`} style={styles.moduleCard}>
              <View style={styles.employeeHeader}>
                <View style={styles.employeeTitleBlock}>
                  <Text style={styles.rowTitle}>{record?.name || 'Product'}</Text>
                  <Text style={styles.rowSubtitle}>{record?.description || record?.category || 'Scanned item'}</Text>
                </View>
                {renderStatusBadge(level.label)}
              </View>
              <View style={styles.employeeMetaGrid}>
                <View style={styles.metaItem}><Text style={styles.metaLabel}>Stock</Text><Text style={styles.metaValue}>{record?.currentStock ?? record?.stockQty ?? 0}</Text></View>
                <View style={styles.metaItem}><Text style={styles.metaLabel}>Unit</Text><Text style={styles.metaValue}>{record?.uom || record?.unit || '-'}</Text></View>
                <View style={styles.metaItem}><Text style={styles.metaLabel}>Price</Text><Text style={styles.metaValue}>{formatMoney(record?.unitPrice || 0)}</Text></View>
              </View>
            </Card>
          );
        })}
      </View>
    </View>
  );

  const renderProductRows = () => {
    if (!records.length) return <EmptyState />;

    return (
      <View style={styles.list}>
        {records.map((record, index) => {
          const id = getId(record);
          const qty = pickValue(record, ['stockQty', 'quantity', 'currentStock']) ?? 0;
          const level = stockLevel(qty);
          
          return (
            <Card key={`${id}-${index}`} style={styles.productCard}>
              <View style={styles.productHeader}>
                <View style={styles.productTitleBlock}>
                  <Text style={styles.productName} numberOfLines={1}>{recordTitle(record, 'Product')}</Text>
                  <Text style={styles.productSku}>{record?.sku || 'No SKU'}</Text>
                </View>
                {renderStatusBadge(level.label, styles[`moduleBadge_${level.tone}`])}
              </View>

              <View style={styles.productDetailGrid}>
                <View style={styles.productDetailItem}>
                  <Text style={styles.metaLabel}>Classification</Text>
                  <Text style={styles.metaValue}>{record?.classification || '-'}</Text>
                </View>
                <View style={styles.productDetailItem}>
                  <Text style={styles.metaLabel}>Category</Text>
                  <Text style={styles.metaValue}>{record?.category?.name || record?.category || '-'}</Text>
                </View>
                <View style={styles.productDetailItem}>
                  <Text style={styles.metaLabel}>Current Stock</Text>
                  <Text style={[styles.metaValue, { color: level.tone === 'danger' ? colors.danger : colors.text }]}>
                    {qty} {record?.uom || record?.unit || 'units'}
                  </Text>
                </View>
              </View>

              <View style={styles.productActionRow}>
                <Pressable 
                  onPress={() => openRecordDetail(record)} 
                  style={({ pressed }) => [styles.actionBtn, styles.viewBtn, pressed && styles.pressed]}
                >
                  <MaterialCommunityIcons name="eye-outline" size={18} color={colors.primary} />
                  <Text style={styles.viewBtnText}>View</Text>
                </Pressable>
                
                {!!item?.updater && (
                  <Pressable 
                    onPress={() => openRecordEdit(record)} 
                    style={({ pressed }) => [styles.actionBtn, styles.editBtn, pressed && styles.pressed]}
                  >
                    <MaterialCommunityIcons name="pencil-outline" size={18} color={colors.primary} />
                    <Text style={styles.editBtnText}>Edit</Text>
                  </Pressable>
                )}
                
                {!!item?.remover && (
                  <Pressable 
                    disabled={updatingId === record._id} 
                    onPress={() => deleteRecord(record)} 
                    style={({ pressed }) => [styles.actionBtn, styles.deleteBtn, pressed && styles.pressed]}
                  >
                    <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.danger} />
                    <Text style={styles.deleteBtnText}>Delete</Text>
                  </Pressable>
                )}
              </View>
            </Card>
          );
        })}
      </View>
    );
  };

  const renderStockRows = () => {
    if (itemKey === 'inventory') return renderStockDashboard();
    if (itemKey === 'barcode') return renderBarcodeScanner();
    if (itemKey === 'products') return renderProductRows();
    return renderStructuredRows();
  };

  const renderAiScoreCard = ({ title: cardTitle, value, subtitle, icon, tone = 'primary', suffix = '' }) => (
    <Card style={[styles.orderKpiCard, styles[`orderKpi_${tone}`]]}>
      <View style={[styles.orderKpiIcon, styles[`orderKpiIcon_${tone}`]]}>
        <MaterialCommunityIcons name={icon} size={22} color="#fff" />
      </View>
      <Text style={styles.orderKpiLabel}>{cardTitle}</Text>
      <Text style={styles.orderKpiValue}>{value}{suffix}</Text>
      <Text style={styles.orderKpiSubtitle}>{subtitle}</Text>
    </Card>
  );

  const renderAiDashboard = () => {
    const data = payload?.data ?? payload ?? {};
    const trend = data.trend || {};
    const lineEfficiency = Array.isArray(data.line_efficiency) ? data.line_efficiency : [];
    const predictedValues = Array.isArray(trend.predicted) ? trend.predicted : [];
    const maxOutput = Math.max(1, ...predictedValues.map((v) => Number(v || 0)));

    return (
      <View style={styles.orderDashboard}>
        <View style={styles.aiHero}>
          <Text style={styles.financialEyebrow}>AI Dashboard</Text>
          <Text style={styles.financialTitle}>Production Intelligence</Text>
          <Text style={styles.financialSubtitle}>Predicted output, efficiency, wastage risk, and line performance grouped like the web dashboard.</Text>
        </View>
        <View style={styles.kpiGrid}>
          {renderAiScoreCard({ title: 'Predicted Output', value: money(data.predicted_daily_output || 0), subtitle: 'Daily production forecast', icon: 'chart-line', tone: 'primary' })}
          {renderAiScoreCard({ title: 'Efficiency Score', value: money(data.efficiency_score || 0), suffix: '%', subtitle: 'Overall AI efficiency', icon: 'speedometer', tone: 'success' })}
          {renderAiScoreCard({ title: 'Wastage', value: money(data.wastage_percent || 0), suffix: '%', subtitle: 'Predicted fabric loss', icon: 'delete-alert-outline', tone: Number(data.wastage_percent || 0) >= 8 ? 'danger' : 'warning' })}
          {renderAiScoreCard({ title: 'Risk Alerts', value: data.risk_alerts || 0, subtitle: 'Items needing attention', icon: 'alert-circle-outline', tone: data.risk_alerts > 0 ? 'danger' : 'success' })}
        </View>
        <Card style={styles.monthCard}>
          <Text style={styles.sectionTitle}>Output Trend</Text>
          {Array.isArray(trend.labels) && trend.labels.length ? trend.labels.map((label, index) => {
            const predicted = Number(trend.predicted?.[index] || 0);
            const actual = Number(trend.actual?.[index] || 0);
            return (
              <View key={`${label}-${index}`} style={styles.chartRow}>
                <Text style={styles.chartLabel}>{label}</Text>
                <View style={styles.chartTrack}><View style={[styles.chartBar, { width: `${Math.max(4, Math.round((predicted / maxOutput) * 100))}%` }]} /></View>
                <Text style={styles.chartValue}>Predicted {predicted} / Actual {actual}</Text>
              </View>
            );
          }) : <Text style={styles.emptyText}>No trend data available.</Text>}
        </Card>
        <Card style={styles.monthCard}>
          <Text style={styles.sectionTitle}>Line Efficiency</Text>
          {lineEfficiency.length ? lineEfficiency.map((line) => (
            <View key={line.line} style={styles.chartRow}>
              <Text style={styles.chartLabel}>{line.line}</Text>
              <View style={styles.chartTrack}><View style={[styles.chartBar, { width: `${Math.max(4, Math.round(Number(line.efficiency || 0)))}%` }]} /></View>
              <Text style={styles.chartValue}>{line.efficiency}% efficiency</Text>
            </View>
          )) : <Text style={styles.emptyText}>No line efficiency data available.</Text>}
        </Card>
      </View>
    );
  };

  const renderAiWastage = () => {
    const data = payload?.data ?? payload ?? {};
    const wastage = Number(data.wastage_percent || 0);
    const risk = wastage >= 8 ? 'High Risk' : wastage >= 5 ? 'Medium Risk' : 'Low Risk';
    return (
      <View style={styles.orderDashboard}>
        <View style={styles.aiHero}>
          <Text style={styles.financialEyebrow}>Wastage Prediction</Text>
          <Text style={styles.financialTitle}>Fabric Loss Forecast</Text>
          <Text style={styles.financialSubtitle}>AI-estimated wastage and risk signals for production planning.</Text>
        </View>
        <View style={styles.kpiGrid}>
          {renderAiScoreCard({ title: 'Predicted Wastage', value: money(wastage), suffix: '%', subtitle: 'Expected fabric loss', icon: 'delete-alert-outline', tone: wastage >= 8 ? 'danger' : 'warning' })}
          {renderAiScoreCard({ title: 'Risk Alerts', value: data.risk_alerts || 0, subtitle: 'Active wastage alerts', icon: 'alert-outline', tone: data.risk_alerts > 0 ? 'danger' : 'success' })}
        </View>
        <Card style={styles.monthCard}>
          <View style={styles.monthHeader}>
            <View>
              <Text style={styles.monthLabel}>Current Risk</Text>
              <Text style={styles.monthTitle}>{risk}</Text>
            </View>
            {renderStatusBadge(risk)}
          </View>
          <Text style={styles.rowSubtitle}>Review cutting accuracy, fabric GSM, and design complexity before production starts.</Text>
        </Card>
      </View>
    );
  };

  const renderAiEfficiency = () => {
    const data = payload?.data ?? payload ?? {};
    const workerTrend = data.worker_trend || {};
    const scores = Array.isArray(workerTrend.scores) ? workerTrend.scores : [];
    return (
      <View style={styles.orderDashboard}>
        <View style={styles.aiHero}>
          <Text style={styles.financialEyebrow}>Efficiency AI</Text>
          <Text style={styles.financialTitle}>Line Efficiency Prediction</Text>
          <Text style={styles.financialSubtitle}>AI view of efficiency, output, and worker trend.</Text>
        </View>
        <View style={styles.kpiGrid}>
          {renderAiScoreCard({ title: 'Efficiency Score', value: money(data.efficiency_score || 0), suffix: '%', subtitle: 'Current prediction', icon: 'speedometer', tone: 'success' })}
          {renderAiScoreCard({ title: 'Predicted Output', value: money(data.predicted_daily_output || 0), subtitle: 'Units per day', icon: 'chart-areaspline', tone: 'primary' })}
        </View>
        <Card style={styles.monthCard}>
          <Text style={styles.sectionTitle}>Worker Trend</Text>
          {scores.length ? scores.map((score, index) => (
            <View key={`${workerTrend.labels?.[index] || index}`} style={styles.chartRow}>
              <Text style={styles.chartLabel}>{workerTrend.labels?.[index] || `Period ${index + 1}`}</Text>
              <View style={styles.chartTrack}><View style={[styles.chartBar, { width: `${Math.max(4, Number(score || 0))}%` }]} /></View>
              <Text style={styles.chartValue}>{score}% score</Text>
            </View>
          )) : <Text style={styles.emptyText}>No worker trend data available.</Text>}
        </Card>
      </View>
    );
  };

  const renderAiSuggestions = () => {
    const data = payload?.data ?? payload ?? {};
    const suggestions = Array.isArray(data.suggestions) ? data.suggestions : toArray(data);
    return (
      <View style={styles.list}>
        <Text style={styles.sectionTitle}>Smart Suggestions</Text>
        {suggestions.length ? suggestions.map((suggestion, index) => (
          <Card key={`${index}-${displayValue(suggestion)}`} style={styles.moduleCard}>
            <View style={styles.employeeHeader}>
              <View style={styles.employeeTitleBlock}>
                <Text style={styles.rowTitle}>{displayValue(suggestion.title || suggestion.type || `Suggestion ${index + 1}`)}</Text>
                <Text style={styles.rowSubtitle}>{displayValue(suggestion.message || suggestion.text || suggestion.description || suggestion, 'Production improvement suggestion')}</Text>
              </View>
              {renderStatusBadge(suggestion.priority || suggestion.severity || 'suggestion')}
            </View>
          </Card>
        )) : <EmptyState />}
      </View>
    );
  };

  const renderAiWorkers = () => {
    const data = payload?.data ?? payload ?? {};
    const workers = Array.isArray(data.workers) ? data.workers : [];
    return (
      <View style={styles.list}>
        <Text style={styles.sectionTitle}>Worker AI</Text>
        {workers.length ? workers.map((worker, index) => (
          <Card key={`${worker._id || index}`} style={styles.moduleCard}>
            <View style={styles.employeeHeader}>
              <View style={styles.employeeTitleBlock}>
                <Text style={styles.rowTitle}>{worker.name || 'Worker'}</Text>
                <Text style={styles.rowSubtitle}>{worker.best_fit_role || worker.role || 'Operator'}</Text>
              </View>
              {renderStatusBadge(worker.trend || 'stable')}
            </View>
            <View style={styles.employeeMetaGrid}>
              <View style={styles.metaItem}><Text style={styles.metaLabel}>Efficiency</Text><Text style={styles.metaValue}>{worker.efficiency_score}%</Text></View>
              <View style={styles.metaItem}><Text style={styles.metaLabel}>Avg Hourly</Text><Text style={styles.metaValue}>{worker.avg_hourly_output}</Text></View>
              <View style={styles.metaItem}><Text style={styles.metaLabel}>QC Pass</Text><Text style={styles.metaValue}>{worker.qc_pass_rate}%</Text></View>
            </View>
            <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, Number(worker.efficiency_score || 0)))}%` }]} /></View>
          </Card>
        )) : <EmptyState />}
      </View>
    );
  };

  const renderAiAlerts = () => {
    const data = payload?.data ?? payload ?? {};
    const alerts = Array.isArray(data.alerts) ? data.alerts : toArray(data);
    return (
      <View style={styles.list}>
        <Text style={styles.sectionTitle}>Alerts</Text>
        {alerts.length ? alerts.map((alert, index) => (
          <Card key={`${index}-${displayValue(alert)}`} style={styles.moduleCard}>
            <View style={styles.employeeHeader}>
              <View style={styles.employeeTitleBlock}>
                <Text style={styles.rowTitle}>{displayValue(alert.title || alert.type || `Alert ${index + 1}`)}</Text>
                <Text style={styles.rowSubtitle}>{displayValue(alert.message || alert.text || alert.description || alert, 'AI alert')}</Text>
              </View>
              {renderStatusBadge(alert.severity || alert.priority || 'risk')}
            </View>
          </Card>
        )) : <EmptyState />}
      </View>
    );
  };

  const renderAiRows = () => {
    if (itemKey === 'ai-dashboard') return renderAiDashboard();
    if (itemKey === 'wastage') return renderAiWastage();
    if (itemKey === 'efficiency') return renderAiEfficiency();
    if (itemKey === 'suggestions') return renderAiSuggestions();
    if (itemKey === 'worker-performance') return renderAiWorkers();
    if (itemKey === 'alerts') return renderAiAlerts();
    return renderStructuredRows();
  };

  const renderSettingsInput = ({ label, value, onChangeText, secureTextEntry, keyboardType, placeholder }) => (
    <View style={styles.settingsField}>
      <Text style={styles.metaLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        placeholder={placeholder || label}
        placeholderTextColor={colors.muted}
        style={styles.lookupInput}
      />
    </View>
  );

  const renderPreferenceToggle = ({ label, subtitle, value, onValueChange }) => (
    <View style={styles.preferenceRow}>
      <View style={styles.employeeTitleBlock}>
        <Text style={styles.preferenceTitle}>{label}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <Switch value={value} onValueChange={onValueChange} thumbColor={value ? colors.primary : '#f4f4f5'} />
    </View>
  );

  const renderAccountProfile = () => {
    const data = payload?.data ?? payload ?? {};
    return (
      <View style={styles.orderDashboard}>
        <Card style={styles.moduleCard}>
          <View style={styles.employeeHeader}>
            <View style={styles.employeeTitleBlock}>
              <Text style={styles.sectionTitle}>Profile Information</Text>
              <Text style={styles.rowSubtitle}>Update your public profile details and contact information.</Text>
            </View>
            {renderStatusBadge(data.employmentStatus || 'active')}
          </View>
          {renderSettingsInput({ label: 'Full Name', value: profileForm.fullName, onChangeText: (v) => updateProfileField('fullName', v) })}
          {renderSettingsInput({ label: 'Email', value: profileForm.email, onChangeText: (v) => updateProfileField('email', v), keyboardType: 'email-address' })}
          {renderSettingsInput({ label: 'Phone', value: profileForm.phone, onChangeText: (v) => updateProfileField('phone', v), keyboardType: 'phone-pad' })}
          {renderSettingsInput({ label: 'Address', value: profileForm.address, onChangeText: (v) => updateProfileField('address', v), placeholder: 'Optional address' })}
          {renderSettingsInput({ label: 'Date of Birth (YYYY-MM-DD)', value: profileForm.dateOfBirth, onChangeText: (v) => updateProfileField('dateOfBirth', v), placeholder: 'YYYY-MM-DD' })}
          {renderSettingsInput({ label: 'Profile Photo URL', value: profileForm.profilePhoto, onChangeText: (v) => updateProfileField('profilePhoto', v), placeholder: 'Optional image URL' })}
          <Button title="Update Profile" loading={accountSaving === 'profile'} onPress={saveAccountProfile} />
        </Card>

        <Card style={styles.moduleCard}>
          <Text style={styles.sectionTitle}>Work Information</Text>
          <View style={styles.employeeMetaGrid}>
            <View style={styles.metaItem}><Text style={styles.metaLabel}>Role</Text><Text style={styles.metaValue}>{data.role || '-'}</Text></View>
            <View style={styles.metaItem}><Text style={styles.metaLabel}>Department</Text><Text style={styles.metaValue}>{data.department || '-'}</Text></View>
            <View style={styles.metaItem}><Text style={styles.metaLabel}>Employee ID</Text><Text style={styles.metaValue}>{data.employeeId || '-'}</Text></View>
            <View style={styles.metaItem}><Text style={styles.metaLabel}>Joined</Text><Text style={styles.metaValue}>{formatDate(data.joinedDate)}</Text></View>
          </View>
        </Card>
      </View>
    );
  };

  const renderAccountSettings = () => (
    <View style={styles.orderDashboard}>
      {renderAccountProfile()}

      <Card style={styles.moduleCard}>
        <Text style={styles.sectionTitle}>Security</Text>
        <Text style={styles.rowSubtitle}>Control password changes when you need them.</Text>
        {renderSettingsInput({ label: 'Current Password', value: passwordForm.currentPassword, onChangeText: (v) => updatePasswordField('currentPassword', v), secureTextEntry: true })}
        {renderSettingsInput({ label: 'New Password', value: passwordForm.newPassword, onChangeText: (v) => updatePasswordField('newPassword', v), secureTextEntry: true })}
        {renderSettingsInput({ label: 'Confirm Password', value: passwordForm.confirmPassword, onChangeText: (v) => updatePasswordField('confirmPassword', v), secureTextEntry: true })}
        <Button title="Change Password" loading={accountSaving === 'password'} onPress={savePassword} />
      </Card>

      <Card style={styles.moduleCard}>
        <Text style={styles.sectionTitle}>Preferences</Text>
        {renderPreferenceToggle({ label: 'Email Notifications', subtitle: 'Receive profile and workflow updates by email.', value: preferencesForm.emailNotifications, onValueChange: (v) => updatePreferenceField('emailNotifications', v) })}
        {renderPreferenceToggle({ label: 'System Alerts', subtitle: 'Show important in-app system alerts.', value: preferencesForm.systemAlerts, onValueChange: (v) => updatePreferenceField('systemAlerts', v) })}
        {renderPreferenceToggle({ label: 'Dark Mode', subtitle: 'Store dark mode preference for supported screens.', value: preferencesForm.darkMode, onValueChange: (v) => updatePreferenceField('darkMode', v) })}
        <Button title="Save Preferences" loading={accountSaving === 'preferences'} onPress={savePreferences} />
      </Card>

      <Button title="Logout" variant="danger" onPress={confirmLogout} />
    </View>
  );

  const renderAccountRows = () => (itemKey === 'settings' ? renderAccountSettings() : renderAccountProfile());

  const renderStructuredDashboard = () => {
    const data = payload?.data ?? payload ?? {};
    const primitiveMetrics = Object.entries(data)
      .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
      .slice(0, 8);
    const arrays = Object.entries(data)
      .filter(([, value]) => Array.isArray(value))
      .slice(0, 4);

    if (!primitiveMetrics.length && !arrays.length) return null;

    return (
      <View style={styles.orderDashboard}>
        <View style={styles.orderHero}>
          <Text style={styles.financialEyebrow}>{item?.title || 'Dashboard'}</Text>
          <Text style={styles.financialTitle}>Clean Summary</Text>
          <Text style={styles.financialSubtitle}>Key numbers and recent activity formatted for mobile review.</Text>
        </View>
        {!!primitiveMetrics.length && (
          <View style={styles.kpiGrid}>
            {primitiveMetrics.map(([key, value]) => renderOrderDashboardCard({
              cardKey: key,
              title: readable(key),
              value: money(value),
              subtitle: 'Current value',
              icon: key.toLowerCase().includes('pending') ? 'clock-outline' : key.toLowerCase().includes('total') ? 'chart-box-outline' : 'chart-timeline-variant',
              tone: key.toLowerCase().includes('delayed') || key.toLowerCase().includes('low') ? 'danger' : key.toLowerCase().includes('delivered') || key.toLowerCase().includes('received') ? 'success' : 'primary',
            }))}
          </View>
        )}
        {arrays.map(([key, value]) => (
          <Card key={key} style={styles.monthCard}>
            <View style={styles.monthHeader}>
              <View>
                <Text style={styles.monthLabel}>{readable(key)}</Text>
                <Text style={styles.monthTitle}>{value.length} records</Text>
              </View>
              <MaterialCommunityIcons name="format-list-bulleted" size={22} color={colors.primary} />
            </View>
            {value.slice(0, 4).map((row, index) => (
              <View key={`${key}-${index}`} style={styles.compactRow}>
                <Text style={styles.compactRowTitle}>{recordTitle(row, `${readable(key)} ${index + 1}`)}</Text>
                <Text style={styles.compactRowMeta}>{displayValue(row?.status || row?.type || row?.label || row?.date)}</Text>
              </View>
            ))}
          </Card>
        ))}
      </View>
    );
  };

  const renderStructuredRows = () => {
    if (['purchase-analytics', 'inventory', 'barcode', 'overview', 'supervisor'].includes(itemKey)) {
      return renderStructuredDashboard();
    }
    if (!records.length) return renderStructuredDashboard();
    if (!Array.isArray(payload) && records.length === 1 && records[0] === (payload?.data ?? payload) && typeof records[0] === 'object') {
      return renderStructuredDashboard();
    }

    return (
      <View style={itemKey === 'materials' || itemKey === 'products' ? styles.cardGrid : styles.list}>
        {records.map((record, index) => {
          const id = getId(record);
          const status = record?.status || record?.state || record?.paymentStatus || record?.overallQcStatus;
          const qty = pickValue(record, ['currentStock', 'stockQuantity', 'stockQty', 'quantity']);
          const level = isStockModule || itemKey === 'materials' ? stockLevel(qty) : null;
          return (
            <Card key={`${id}-${index}`} style={[styles.moduleCard, (itemKey === 'materials' || itemKey === 'products') && styles.gridCard]}>
              <View style={styles.employeeHeader}>
                <View style={styles.employeeTitleBlock}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{recordTitle(record, item?.title)}</Text>
                  <Text style={styles.rowSubtitle} numberOfLines={2}>
                    {displayValue(record?.description || record?.notes || record?.reason || pickValue(record, ['supplier.name', 'customerName', 'material.name', 'email']), 'No description')}
                  </Text>
                </View>
                {level ? renderStatusBadge(level.label, styles[`moduleBadge_${level.tone}`]) : status ? renderStatusBadge(status) : null}
              </View>

              <View style={styles.employeeMetaGrid}>
                {fieldSetForRecord(record).filter(([, value]) => value !== undefined && value !== null && value !== '').slice(0, 4).map(([label, value]) => (
                  <View key={label} style={styles.metaItem}>
                    <Text style={styles.metaLabel}>{label}</Text>
                    <Text style={styles.metaValue} numberOfLines={2}>{displayValue(value)}</Text>
                  </View>
                ))}
              </View>

              {isPurchaseModule && itemKey === 'purchase-orders' ? renderPurchaseStepper(status) : null}
              {isStockModule && itemKey === 'history' ? (
                <View style={styles.timelineLine}>
                  <View style={styles.timelineDot} />
                  <Text style={styles.rowSubtitle}>{displayValue(record?.note || record?.reason || record?.description, 'Stock movement recorded')}</Text>
                </View>
              ) : null}

              <View style={styles.employeeActions}>
                <Pressable onPress={() => openRecordDetail(record)} style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
                  <MaterialCommunityIcons name="eye-outline" size={17} color={colors.primary} />
                  <Text style={styles.editButtonText}>View</Text>
                </Pressable>
                {!!item?.updater && (
                  <Pressable onPress={() => openRecordEdit(record)} style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
                    <MaterialCommunityIcons name="pencil" size={17} color={colors.primary} />
                    <Text style={styles.editButtonText}>Edit</Text>
                  </Pressable>
                )}
                {!!item?.remover && (
                  <Pressable disabled={updatingId === record._id} onPress={() => deleteRecord(record)} style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}>
                    <MaterialCommunityIcons name="trash-can-outline" size={17} color={colors.danger} />
                    <Text style={styles.deleteButtonText}>Delete</Text>
                  </Pressable>
                )}
              </View>
            </Card>
          );
        })}
      </View>
    );
  };

  const changeExpenseStatus = async (expense, status) => {
    if (!item?.updater || !expense?._id || expense.status === status) return;

    setUpdatingId(expense._id);
    try {
      await item.updater(expense._id, { status });
      setPayload((prev) => {
        const list = toArray(prev).map((row) => (row?._id === expense._id ? { ...row, status } : row));
        return Array.isArray(prev) ? list : { ...prev, items: list, data: Array.isArray(prev?.data) ? list : prev?.data };
      });
      await load();
    } catch (err) {
      Alert.alert('Status update failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not update expense status.');
    } finally {
      setUpdatingId('');
    }
  };

  const openExpenseEdit = (expense) => {
    navigation.navigate('Form', {
      moduleKey,
      itemKey,
      title: 'Expense',
      mode: 'edit',
      record: expense,
    });
  };

  const deleteExpense = (expense) => {
    if (!item?.remover || !expense?._id) return;

    Alert.alert('Delete expense', 'Are you sure you want to delete this expense?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setUpdatingId(expense._id);
          try {
            await item.remover(expense._id);
            setPayload((prev) => {
              const list = toArray(prev).filter((row) => row?._id !== expense._id);
              return Array.isArray(prev) ? list : { ...prev, items: list, data: Array.isArray(prev?.data) ? list : prev?.data };
            });
          } catch (err) {
            Alert.alert('Delete failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not delete expense.');
          } finally {
            setUpdatingId('');
          }
        },
      },
    ]);
  };

  const renderExpenseRows = () => (
    <View style={styles.list}>
      {records.map((expense, index) => {
        const id = getId(expense);
        const currentStatus = expense?.status || 'pending';
        return (
          <Card key={`${id}-${index}`} style={styles.employeeCard}>
            <View style={styles.employeeHeader}>
              <View style={styles.employeeTitleBlock}>
                <Text style={styles.rowTitle} numberOfLines={1}>{expenseTitle(expense)}</Text>
                <Text style={styles.rowSubtitle} numberOfLines={1}>
                  {expenseCategoryName(expense)} · {formatDate(expense?.date)}
                </Text>
              </View>
              <View style={[styles.statusBadge, styles[`expenseStatus_${currentStatus}`] || styles.statusInactive]}>
                <Text style={[styles.statusText, styles[`expenseStatusText_${currentStatus}`] || styles.statusTextInactive]}>
                  {statusLabel(currentStatus)}
                </Text>
              </View>
            </View>

            <View style={styles.employeeMetaGrid}>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Amount</Text>
                <Text style={styles.metaValue}>{formatMoney(expense?.amount)}</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Payment</Text>
                <Text style={styles.metaValue}>{statusLabel(expense?.paymentMethod || 'cash')}</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Vendor</Text>
                <Text style={styles.metaValue}>{expense?.vendorName || '-'}</Text>
              </View>
            </View>

            <View style={styles.statusActions}>
              {expenseStatuses.map((status) => (
                <Pressable
                  key={status}
                  disabled={updatingId === expense._id || currentStatus === status}
                  onPress={() => changeExpenseStatus(expense, status)}
                  style={({ pressed }) => [
                    styles.statusActionButton,
                    currentStatus === status && styles.statusActionActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.statusActionText, currentStatus === status && styles.statusActionTextActive]}>
                    {statusLabel(status)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.employeeActions}>
              <Pressable
                onPress={() => navigation.navigate('Detail', { title: expenseTitle(expense), record: expense })}
                style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="eye-outline" size={17} color={colors.primary} />
                <Text style={styles.editButtonText}>View</Text>
              </Pressable>
              <Pressable
                onPress={() => openExpenseEdit(expense)}
                style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="pencil" size={17} color={colors.primary} />
                <Text style={styles.editButtonText}>Edit</Text>
              </Pressable>
              <Pressable
                onPress={() => deleteExpense(expense)}
                disabled={updatingId === expense._id}
                style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="trash-can-outline" size={17} color={colors.danger} />
                <Text style={styles.deleteButtonText}>Delete</Text>
              </Pressable>
            </View>
          </Card>
        );
      })}
    </View>
  );

  const openCategoryEdit = (category) => {
    navigation.navigate('Form', {
      moduleKey,
      itemKey,
      title: 'Category',
      mode: 'edit',
      record: category,
    });
  };

  const deleteCategory = (category) => {
    if (!item?.remover || !category?._id) return;

    Alert.alert('Delete category', `Are you sure you want to delete "${category.name || 'this category'}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setUpdatingId(category._id);
          try {
            await item.remover(category._id);
            setPayload((prev) => {
              const list = toArray(prev).filter((row) => row?._id !== category._id);
              return Array.isArray(prev) ? list : { ...prev, items: list, data: Array.isArray(prev?.data) ? list : prev?.data };
            });
          } catch (err) {
            Alert.alert('Delete failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not delete category.');
          } finally {
            setUpdatingId('');
          }
        },
      },
    ]);
  };

  const configureRecurringCost = (category) => {
    navigation.navigate('Form', {
      moduleKey: 'expenses',
      itemKey: 'categories',
      title: 'Category',
      mode: 'edit',
      record: category,
    });
  };

  const recordRecurringExpense = (category) => {
    navigation.navigate('Form', {
      moduleKey: 'expenses',
      itemKey: 'expenses',
      title: 'Expense',
      prefill: {
        category: category?._id,
        date: new Date().toISOString().slice(0, 10),
        description: `Recurring payment - ${category?.name || 'Recurring cost'}`,
        paymentMethod: 'bank_transfer',
        isRecurring: true,
        recurringMonth: new Date().getMonth() + 1,
      },
    });
  };

  const deactivateRecurringCost = (category) => {
    if (!category?._id) return;

    Alert.alert('Deactivate recurring cost', `Stop recurring setup for ${category.name || 'this category'}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Deactivate',
        style: 'destructive',
        onPress: async () => {
          setUpdatingId(category._id);
          try {
            await expensesApi.updateCategory(category._id, { isRecurring: false, recurringDay: null });
            setPayload((prev) => {
              const list = toArray(prev).filter((row) => row?._id !== category._id);
              return Array.isArray(prev) ? list : { ...prev, items: list, data: Array.isArray(prev?.data) ? list : prev?.data };
            });
          } catch (err) {
            Alert.alert('Deactivate failed', err.response?.data?.error || err.response?.data?.message || err.message || 'Could not deactivate recurring cost.');
          } finally {
            setUpdatingId('');
          }
        },
      },
    ]);
  };

  const nextDueDateFor = (day) => {
    const dueDay = Math.max(1, Math.min(31, Number(day || 1)));
    const now = new Date();
    const date = new Date(now.getFullYear(), now.getMonth(), dueDay);
    if (date < now) date.setMonth(date.getMonth() + 1);
    return formatDate(date);
  };

  const renderRecurringRows = () => (
    <View style={styles.list}>
      <Text style={styles.sectionTitle}>Open Records</Text>
      {records.map((category, index) => (
        <Card key={`${getId(category)}-${index}`} style={styles.moduleCard}>
          <View style={styles.employeeHeader}>
            <View style={styles.employeeTitleBlock}>
              <Text style={styles.rowTitle} numberOfLines={1}>{category?.name || 'Recurring cost'}</Text>
              <Text style={styles.rowSubtitle} numberOfLines={2}>{category?.description || 'Fixed recurring cost profile'}</Text>
            </View>
            {renderStatusBadge(category?.status || 'active')}
          </View>

          <View style={styles.employeeMetaGrid}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Type</Text>
              <Text style={styles.metaValue}>{statusLabel(category?.type || 'other')}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Due Day</Text>
              <Text style={styles.metaValue}>{category?.recurringDay || '-'}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Next Due</Text>
              <Text style={styles.metaValue}>{nextDueDateFor(category?.recurringDay)}</Text>
            </View>
          </View>

          <View style={styles.workflowBox}>
            <Text style={styles.metaLabel}>Workflow</Text>
            <Text style={styles.rowSubtitle}>Configure recurrence, record manual expense entry, or deactivate to stop future recurring records.</Text>
          </View>

          <View style={styles.recurringActions}>
            <Pressable onPress={() => configureRecurringCost(category)} style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
              <MaterialCommunityIcons name="cog-outline" size={17} color={colors.primary} />
              <Text style={styles.editButtonText}>Configure</Text>
            </Pressable>
            <Pressable onPress={() => recordRecurringExpense(category)} style={({ pressed }) => [styles.recordButton, pressed && styles.pressed]}>
              <MaterialCommunityIcons name="cash-plus" size={17} color="#fff" />
              <Text style={styles.recordButtonText}>Record Expense</Text>
            </Pressable>
            <Pressable disabled={updatingId === category._id} onPress={() => deactivateRecurringCost(category)} style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}>
              <MaterialCommunityIcons name="cancel" size={17} color={colors.danger} />
              <Text style={styles.deleteButtonText}>Deactivate</Text>
            </Pressable>
          </View>
        </Card>
      ))}
    </View>
  );

  const renderCategoryRows = () => (
    <View style={styles.list}>
      {records.map((category, index) => {
        const id = getId(category);
        return (
          <Card key={`${id}-${index}`} style={styles.employeeCard}>
            <View style={styles.employeeHeader}>
              <View style={styles.employeeTitleBlock}>
                <Text style={styles.rowTitle} numberOfLines={1}>{category?.name || 'Unnamed category'}</Text>
                {!!category?.description && <Text style={styles.rowSubtitle} numberOfLines={2}>{category.description}</Text>}
              </View>
              {!!category?.status && (
                <View style={[styles.statusBadge, category.status === 'active' ? styles.statusActive : styles.statusInactive]}>
                  <Text style={[styles.statusText, category.status === 'active' ? styles.statusTextActive : styles.statusTextInactive]}>
                    {statusLabel(category.status)}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.employeeMetaGrid}>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Type</Text>
                <Text style={styles.metaValue}>{statusLabel(category?.type || 'other')}</Text>
              </View>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Recurring</Text>
                <Text style={styles.metaValue}>{category?.isRecurring ? 'Yes' : 'No'}</Text>
              </View>
            </View>

            <View style={styles.employeeActions}>
              <Pressable
                onPress={() => openCategoryEdit(category)}
                style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="pencil" size={17} color={colors.primary} />
                <Text style={styles.editButtonText}>Edit</Text>
              </Pressable>
              <Pressable
                onPress={() => deleteCategory(category)}
                disabled={updatingId === category._id}
                style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name="trash-can-outline" size={17} color={colors.danger} />
                <Text style={styles.deleteButtonText}>Delete</Text>
              </Pressable>
            </View>
          </Card>
        );
      })}
    </View>
  );

  const renderKpiCard = ({ title: cardTitle, value, subtitle, icon, tone, status }) => (
    <Card style={[styles.kpiCard, tone === 'danger' && styles.kpiDangerCard, tone === 'success' && styles.kpiSuccessCard, tone === 'warning' && styles.kpiWarningCard]}>
      <View style={styles.kpiHeader}>
        <View style={[styles.kpiIcon, tone === 'danger' && styles.kpiIconDanger, tone === 'success' && styles.kpiIconSuccess, tone === 'warning' && styles.kpiIconWarning]}>
          <MaterialCommunityIcons name={icon} size={22} color="#fff" />
        </View>
        {status ? (
          <View style={[styles.kpiStatus, tone === 'danger' && styles.kpiStatusDanger, tone === 'success' && styles.kpiStatusSuccess, tone === 'warning' && styles.kpiStatusWarning]}>
            <Text style={[styles.kpiStatusText, tone === 'danger' && styles.kpiStatusTextDanger, tone === 'success' && styles.kpiStatusTextSuccess, tone === 'warning' && styles.kpiStatusTextWarning]}>
              {status}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.kpiTitle}>{cardTitle}</Text>
      <Text style={styles.kpiValue}>{formatMoney(value)}</Text>
      <Text style={styles.kpiSubtitle}>{subtitle}</Text>
    </Card>
  );

  const renderFinancialHealth = () => {
    if (!financialSummary) return null;

    const healthTone = financialSummary.netExpense < 0 ? 'danger' : 'success';

    return (
      <View style={styles.financialDashboard}>
        <View style={styles.financialHero}>
          <Text style={styles.financialEyebrow}>Financial Health Dashboard</Text>
          <Text style={styles.financialTitle}>Expense Management Overview</Text>
          <Text style={styles.financialSubtitle}>
            Quick KPI view for expenses, material spend, operating costs, and overall financial impact.
          </Text>
        </View>

        <View style={styles.kpiGrid}>
          {renderKpiCard({
            title: 'Total Expenses',
            value: financialSummary.totalExpenses,
            subtitle: 'All expense records',
            icon: 'receipt-text-outline',
            tone: 'danger',
          })}
          {renderKpiCard({
            title: 'Raw Material Cost',
            value: financialSummary.rawMaterialCost,
            subtitle: 'Direct material spend',
            icon: 'package-variant-closed',
            tone: 'warning',
          })}
          {renderKpiCard({
            title: 'Operational Expenses',
            value: financialSummary.operationalExpenses,
            subtitle: 'Operational cost summary',
            icon: 'office-building-cog-outline',
            tone: 'warning',
          })}
          {renderKpiCard({
            title: 'Net Expense / Financial Health',
            value: financialSummary.netExpense,
            subtitle: financialSummary.hasIncome ? 'Total income minus total expenses' : 'Overall expense impact',
            icon: financialSummary.netExpense < 0 ? 'trending-down' : 'trending-up',
            tone: healthTone,
            status: financialSummary.status,
          })}
        </View>
      </View>
    );
  };

  return (
    <ScreenScaffold
      title={title || item?.title || 'Records'}
      subtitle="Live data from the existing MERN backend API."
      refreshing={loading}
      onRefresh={load}
      actions={
        item?.creator ? (
          <Button
            title="Add"
            onPress={() => navigation.navigate('Form', { moduleKey, itemKey, title: isEmployeeManagement ? 'Employee' : isExpenseList ? 'Expense' : isExpenseCategories ? 'Category' : title || item?.title })}
            style={styles.addButton}
          />
        ) : null
      }
    >
      {loading ? <LoadingState /> : null}
      {!!error && (
        <Card>
          <Text style={styles.error}>{error}</Text>
          <Button title="Retry" variant="secondary" onPress={load} />
        </Card>
      )}
      {!loading && !error && isFinancialHealth && renderFinancialHealth()}
      {!loading && !error && isOrdersDashboard && renderOrdersDashboard()}
      {!loading && !error && isOrderReport && renderOrderReport()}
      {!loading && !error && !isFinancialHealth && !isOrdersDashboard && !isOrderReport && !isSalesModule && !isAiModule && !isAccountModule && !isStructuredModule && metrics.length > 0 && records.length <= 1 && (
        <View style={styles.metrics}>
          {metrics.map(([key, value]) => (
            <Card key={key} style={styles.metric}>
              <Text style={styles.metricLabel}>{readable(key)}</Text>
              <Text style={styles.metricValue}>{money(value)}</Text>
            </Card>
          ))}
        </View>
      )}
      {!loading && !error && !isFinancialHealth && !isOrdersDashboard && !isOrderReport && !isSalesModule && !isAiModule && !isAccountModule && !isStructuredModule && !isRecurringCosts && records.length === 0 && <EmptyState />}
      {!loading && !error && isRecurringCosts && records.length === 0 && <EmptyState />}
      {!loading && !error && isEmployeeManagement && renderEmployeeSummary()}
      {!loading && !error && isEmployeeManagement && renderEmployeeRows()}
      {!loading && !error && isAccountRequests && renderAccountRequestRows()}
      {!loading && !error && isAllOrders && renderOrderRows()}
      {!loading && !error && isSalesModule && renderSalesRows()}
      {!loading && !error && isAiModule && renderAiRows()}
      {!loading && !error && isAccountModule && renderAccountRows()}
      {!loading && !error && isManufacturingModule && renderManufacturingRows()}
      {!loading && !error && isStockModule && renderStockRows()}
      {!loading && !error && isStructuredModule && !isManufacturingModule && !isStockModule && renderStructuredRows()}
      {!loading && !error && isExpenseList && renderExpenseRows()}
      {!loading && !error && isExpenseCategories && renderCategoryRows()}
      {!loading && !error && isRecurringCosts && renderRecurringRows()}
      {!loading && !error && !isEmployeeManagement && !isAccountRequests && !isOrdersDashboard && !isOrderReport && !isAllOrders && !isSalesModule && !isAiModule && !isAccountModule && !isStructuredModule && !isExpenseList && !isExpenseCategories && !isRecurringCosts && !isFinancialHealth && (
        <View style={styles.list}>
          {records.map((record, index) => (
            <Pressable
              key={`${getId(record)}-${index}`}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => navigation.navigate('Detail', { title: titleFor(record, item?.title), record })}
            >
              <View style={styles.rowTop}>
                <Text style={styles.rowTitle} numberOfLines={1}>{titleFor(record, item?.title)}</Text>
                <StatusPill value={record?.status || record?.state || record?.role} />
              </View>
              {!!subtitleFor(record) && <Text style={styles.rowSubtitle} numberOfLines={2}>{String(subtitleFor(record))}</Text>}
              <View style={styles.rowFooter}>
                <Text style={styles.rowMeta}>{record?.createdAt ? new Date(record.createdAt).toLocaleDateString() : getId(record)}</Text>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} />
              </View>
            </Pressable>
          ))}
        </View>
      )}
      <Modal visible={!!reviewModal.type} transparent animationType="slide" onRequestClose={closeReviewModal}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeReviewModal} />
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.modalTitle}>
              {reviewModal.type === 'approve' ? 'Approve User Request' : 'Reject User Request'}
            </Text>
            <Text style={styles.modalSubtitle} numberOfLines={2}>
              {reviewModal.request?.fullName || 'Pending user'} {reviewModal.request?.email ? `- ${reviewModal.request.email}` : ''}
            </Text>

            {reviewModal.type === 'approve' ? (
              <>
                <Text style={styles.modalLabel}>Role</Text>
                <View style={styles.roleGrid}>
                  {requestRoles.map((role) => {
                    const selected = approveRole === role;
                    return (
                      <Pressable
                        key={role}
                        onPress={() => setApproveRole(role)}
                        style={({ pressed }) => [styles.roleOption, selected && styles.roleOptionSelected, pressed && styles.pressed]}
                      >
                        <Text style={[styles.roleOptionText, selected && styles.roleOptionTextSelected]}>
                          {ROLE_LABELS[role] || statusLabel(role)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Button
                  title="Confirm Approve"
                  loading={!!updatingId}
                  disabled={!approveRole || !!updatingId}
                  onPress={confirmApproveRequest}
                  style={styles.confirmApprove}
                />
              </>
            ) : (
              <>
                <Text style={styles.modalLabel}>Enter reason</Text>
                <TextInput
                  value={rejectReason}
                  onChangeText={setRejectReason}
                  placeholder="Enter reason"
                  placeholderTextColor={colors.muted}
                  multiline
                  textAlignVertical="top"
                  style={styles.reasonInput}
                />
                <Button
                  title="Confirm Reject"
                  variant="danger"
                  loading={!!updatingId}
                  disabled={!rejectReason.trim() || !!updatingId}
                  onPress={confirmRejectRequest}
                />
              </>
            )}
            <Button title="Cancel" variant="secondary" disabled={!!updatingId} onPress={closeReviewModal} style={styles.cancelModalButton} />
          </View>
        </View>
      </Modal>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  addButton: {
    minHeight: 38,
    paddingHorizontal: 12,
  },
  error: {
    color: colors.danger,
    marginBottom: 12,
    lineHeight: 20,
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metric: {
    width: '48%',
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 12,
    textTransform: 'capitalize',
  },
  metricValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 5,
  },
  list: {
    gap: 10,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    minWidth: '30%',
    gap: 6,
  },
  summaryLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  summaryValue: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  summaryActive: {
    color: '#15803d',
  },
  summaryInactive: {
    color: colors.danger,
  },
  financialDashboard: {
    gap: 14,
  },
  financialHero: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 5,
  },
  financialEyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  financialTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  financialSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  kpiCard: {
    width: '48%',
    minHeight: 158,
    justifyContent: 'space-between',
    gap: 8,
  },
  kpiDangerCard: {
    borderColor: '#fecaca',
  },
  kpiSuccessCard: {
    borderColor: '#bbf7d0',
  },
  kpiWarningCard: {
    borderColor: '#fed7aa',
  },
  kpiHeader: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  kpiIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  kpiIconDanger: {
    backgroundColor: colors.danger,
  },
  kpiIconSuccess: {
    backgroundColor: colors.success,
  },
  kpiIconWarning: {
    backgroundColor: colors.warning,
  },
  kpiStatus: {
    borderRadius: 999,
    backgroundColor: colors.chip,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  kpiStatusDanger: {
    backgroundColor: '#fee2e2',
  },
  kpiStatusSuccess: {
    backgroundColor: '#dcfce7',
  },
  kpiStatusWarning: {
    backgroundColor: '#ffedd5',
  },
  kpiStatusText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
  },
  kpiStatusTextDanger: {
    color: colors.danger,
  },
  kpiStatusTextSuccess: {
    color: colors.success,
  },
  kpiStatusTextWarning: {
    color: colors.warning,
  },
  kpiTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
  },
  kpiValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  kpiSubtitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  orderDashboard: {
    gap: 14,
  },
  orderHero: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
    gap: 5,
  },
  aiHero: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: colors.surface,
    padding: 16,
    gap: 5,
  },
  orderKpiCard: {
    width: '48%',
    minHeight: 148,
    gap: 8,
    justifyContent: 'space-between',
  },
  orderKpi_neutral: {
    borderColor: colors.border,
  },
  orderKpi_success: {
    borderColor: '#bbf7d0',
  },
  orderKpi_danger: {
    borderColor: '#fecaca',
  },
  orderKpi_primary: {
    borderColor: '#bfdbfe',
  },
  orderKpi_warning: {
    borderColor: '#fed7aa',
  },
  orderKpiIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.muted,
  },
  orderKpiIcon_neutral: {
    backgroundColor: colors.muted,
  },
  orderKpiIcon_success: {
    backgroundColor: colors.success,
  },
  orderKpiIcon_danger: {
    backgroundColor: colors.danger,
  },
  orderKpiIcon_primary: {
    backgroundColor: colors.primary,
  },
  orderKpiIcon_warning: {
    backgroundColor: colors.warning,
  },
  orderKpiLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
  },
  orderKpiValue: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '900',
  },
  orderKpiSubtitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  monthCard: {
    gap: 13,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  monthLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  monthTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    marginTop: 2,
  },
  monthRateBadge: {
    borderRadius: 999,
    backgroundColor: colors.chip,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  monthRateText: {
    color: colors.primary,
    fontWeight: '900',
  },
  reportGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  reportItem: {
    width: '48%',
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
    padding: 10,
    gap: 4,
  },
  reportValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  chartRow: {
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  chartLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  chartTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  chartBar: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.success,
  },
  chartValue: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  emptyText: {
    color: colors.muted,
    lineHeight: 20,
  },
  statusMixRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  statusMixValue: {
    color: colors.text,
    fontWeight: '900',
  },
  scannerPanel: {
    minHeight: 250,
    borderRadius: 8,
    backgroundColor: colors.sidebar,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    gap: 10,
  },
  scannerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
  },
  scannerSubtitle: {
    color: '#cbd5e1',
    textAlign: 'center',
    lineHeight: 19,
  },
  scannerFrame: {
    width: '78%',
    height: 86,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.success,
    marginTop: 8,
  },
  lookupInput: {
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    paddingHorizontal: 12,
  },
  settingsField: {
    gap: 7,
  },
  preferenceRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 10,
  },
  preferenceTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  orderPrimaryText: {
    color: colors.primary,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  mfgMiniTimeline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
    padding: 10,
  },
  mfgMiniStep: {
    width: '30%',
    gap: 5,
  },
  mfgMiniDot: {
    width: 13,
    height: 13,
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  mfgMiniDotDone: {
    backgroundColor: colors.success,
  },
  mfgMiniDotActive: {
    backgroundColor: colors.primary,
  },
  mfgMiniText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 13,
  },
  mfgMiniTextActive: {
    color: colors.text,
  },
  approveSmallButton: {
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  approveSmallText: {
    color: '#fff',
    fontWeight: '900',
  },
  rejectSmallButton: {
    minHeight: 38,
    borderRadius: 8,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  rejectSmallText: {
    color: '#fff',
    fontWeight: '900',
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  moduleCard: {
    gap: 12,
  },
  gridCard: {
    width: '48%',
    minHeight: 190,
  },
  productCard: {
    gap: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  productHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  productTitleBlock: {
    flex: 1,
    gap: 4,
  },
  productName: {
    fontSize: 17,
    fontWeight: '900',
    color: colors.text,
  },
  productSku: {
    fontSize: 13,
    color: colors.muted,
    fontWeight: '600',
  },
  productDetailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    backgroundColor: colors.surfaceMuted,
    padding: 12,
    borderRadius: 8,
  },
  productDetailItem: {
    width: '45%',
    gap: 4,
  },
  productActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  viewBtn: {
    borderColor: colors.primary + '30',
  },
  editBtn: {
    borderColor: colors.primary + '30',
  },
  deleteBtn: {
    borderColor: colors.danger + '30',
  },
  viewBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
  },
  editBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
  },
  deleteBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.danger,
  },
  moduleBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.chip,
  },
  moduleBadge_success: {
    backgroundColor: '#dcfce7',
  },
  moduleBadge_danger: {
    backgroundColor: '#fee2e2',
  },
  moduleBadge_warning: {
    backgroundColor: '#fef3c7',
  },
  moduleBadge_neutral: {
    backgroundColor: '#f1f5f9',
  },
  moduleBadgeText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'capitalize',
  },
  moduleBadgeText_success: {
    color: '#15803d',
  },
  moduleBadgeText_danger: {
    color: colors.danger,
  },
  moduleBadgeText_warning: {
    color: '#b45309',
  },
  moduleBadgeText_neutral: {
    color: colors.muted,
  },
  compactStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
    padding: 10,
  },
  compactStep: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
  },
  compactStepDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  compactStepDotDone: {
    backgroundColor: colors.success,
  },
  compactStepText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
    textTransform: 'capitalize',
  },
  compactStepTextDone: {
    color: colors.text,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 9,
  },
  compactRowTitle: {
    flex: 1,
    color: colors.text,
    fontWeight: '800',
  },
  compactRowMeta: {
    color: colors.muted,
    fontSize: 12,
    textTransform: 'capitalize',
  },
  timelineLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
    padding: 10,
  },
  workflowBox: {
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
    padding: 10,
    gap: 4,
  },
  recurringActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  recordButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.success,
  },
  recordButtonText: {
    color: '#fff',
    fontWeight: '900',
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.primary,
    marginTop: 5,
  },
  timelineDotDanger: {
    backgroundColor: colors.danger,
  },
  row: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
    gap: 8,
  },
  pressed: {
    opacity: 0.75,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  rowTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
  },
  rowSubtitle: {
    color: colors.muted,
    lineHeight: 19,
  },
  rowFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowMeta: {
    color: colors.muted,
    fontSize: 12,
  },
  employeeCard: {
    gap: 12,
  },
  employeeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  employeeTitleBlock: {
    flex: 1,
    gap: 4,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusActive: {
    backgroundColor: '#dcfce7',
  },
  statusInactive: {
    backgroundColor: '#f1f5f9',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '900',
  },
  statusTextActive: {
    color: '#15803d',
  },
  statusTextInactive: {
    color: colors.muted,
  },
  employeeMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metaItem: {
    minWidth: '30%',
    flex: 1,
    gap: 3,
  },
  metaLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  metaValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  employeeActions: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  statusToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    height: 9,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  requestReason: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
    padding: 10,
  },
  requestActions: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  reviewButton: {
    minHeight: 42,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  approveButton: {
    backgroundColor: colors.success,
  },
  rejectButton: {
    backgroundColor: colors.danger,
  },
  reviewButtonText: {
    color: '#fff',
    fontWeight: '900',
  },
  editButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  editButtonText: {
    color: colors.primary,
    fontWeight: '900',
  },
  deleteButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fecaca',
    paddingHorizontal: 12,
    backgroundColor: '#fff1f2',
  },
  deleteButtonText: {
    color: colors.danger,
    fontWeight: '900',
  },
  statusActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusActionButton: {
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusActionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.chip,
  },
  statusActionText: {
    color: colors.muted,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  statusActionTextActive: {
    color: colors.primary,
  },
  expenseStatus_pending: {
    backgroundColor: '#fef3c7',
  },
  expenseStatus_approved: {
    backgroundColor: '#dcfce7',
  },
  expenseStatus_rejected: {
    backgroundColor: '#fee2e2',
  },
  expenseStatusText_pending: {
    color: '#b45309',
  },
  expenseStatusText_approved: {
    color: '#15803d',
  },
  expenseStatusText_rejected: {
    color: colors.danger,
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
  modalLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '900',
  },
  roleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  roleOption: {
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.chip,
  },
  roleOptionText: {
    color: colors.muted,
    fontWeight: '800',
  },
  roleOptionTextSelected: {
    color: colors.primary,
  },
  reasonInput: {
    minHeight: 112,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    padding: 12,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  confirmApprove: {
    backgroundColor: colors.success,
  },
  cancelModalButton: {
    marginTop: 2,
  },
});

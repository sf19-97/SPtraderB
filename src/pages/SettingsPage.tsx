import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBrokerStore } from '../stores/useBrokerStore';
import {
  Container,
  Title,
  Tabs,
  Box,
  Paper,
  Stack,
  Group,
  Text,
  Button,
  ActionIcon,
  Collapse,
  Badge,
  TextInput,
  PasswordInput,
  Select,
  Modal,
  Divider,
} from '@mantine/core';
import {
  IconPlus,
  IconChevronDown,
  IconChevronRight,
  IconEdit,
  IconTrash,
  IconServer,
  IconKey,
  IconUser,
  IconCircleCheck,
  IconArrowLeft,
} from '@tabler/icons-react';

interface BrokerProfile {
  id: string;
  name: string;
  broker: string;
  apiKey: string;
  account: string;
  isActive: boolean;
}

export const SettingsPage = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<string | null>('broker');
  const {
    profiles,
    addProfile,
    updateProfile,
    deleteProfile,
    activateProfile,
    decryptSensitiveData,
  } = useBrokerStore();

  const [expandedProfiles, setExpandedProfiles] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<BrokerProfile | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    broker: '',
    apiKey: '',
    account: '',
  });

  // Load demo profiles from env on first load if no profiles exist
  useEffect(() => {
    if (profiles.length === 0) {
      // Check for demo credentials in environment variables
      const oandaKey = import.meta.env.VITE_OANDA_DEMO_API_KEY;
      const oandaAccount = import.meta.env.VITE_OANDA_DEMO_ACCOUNT_ID;

      if (oandaKey && oandaAccount) {
        addProfile({
          name: 'OANDA Demo (from env)',
          broker: 'OANDA',
          apiKey: oandaKey,
          account: oandaAccount,
          environment: 'demo',
        });
      }
    }
  }, []);

  const toggleProfile = (profileId: string) => {
    setExpandedProfiles((prev) =>
      prev.includes(profileId) ? prev.filter((id) => id !== profileId) : [...prev, profileId]
    );
  };

  const openModal = (profile?: BrokerProfile) => {
    if (profile) {
      setEditingProfile(profile);
      setFormData({
        name: profile.name,
        broker: profile.broker,
        apiKey: decryptSensitiveData(profile.apiKey),
        account: profile.account,
      });
    } else {
      setEditingProfile(null);
      setFormData({
        name: '',
        broker: '',
        apiKey: '',
        account: '',
      });
    }
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingProfile(null);
    setFormData({
      name: '',
      broker: '',
      apiKey: '',
      account: '',
    });
  };

  const saveProfile = () => {
    if (editingProfile) {
      // Edit existing profile
      updateProfile(editingProfile.id, formData);
    } else {
      // Add new profile
      addProfile(formData);
    }
    closeModal();
  };

  // Helper to display masked API key
  const maskApiKey = (encryptedKey: string) => {
    const decrypted = decryptSensitiveData(encryptedKey);
    if (decrypted.length <= 8) return '••••••••';
    return `••••••••••••${decrypted.slice(-4)}`;
  };

  return (
    <Container size="lg" py="xl" style={{ color: '#fff' }}>
      <Group justify="space-between" mb="xl">
        <Group gap="md">
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => navigate(-1)}>
            <IconArrowLeft size={20} />
          </ActionIcon>
          <Title order={2} c="white">
            Settings
          </Title>
        </Group>
      </Group>

      <Tabs
        value={activeTab}
        onChange={setActiveTab}
        styles={{
          root: { backgroundColor: 'transparent' },
          list: { backgroundColor: '#1a1a1a', borderBottom: '1px solid #333' },
          tab: {
            color: '#888',
            '&:hover': {
              backgroundColor: '#252525',
            },
          },
        }}
      >
        <Tabs.List>
          <Tabs.Tab value="broker">Broker Profiles</Tabs.Tab>
          <Tabs.Tab value="display">Display</Tabs.Tab>
          <Tabs.Tab value="data">Data</Tabs.Tab>
          <Tabs.Tab value="advanced">Advanced</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="broker" pt="xl">
          <Paper
            p="md"
            withBorder
            style={{
              backgroundColor: '#1a1a1a',
              borderColor: '#333',
            }}
          >
            <Group justify="space-between" mb="md">
              <Title order={4} c="white">
                Broker Profiles
              </Title>
              <Button leftSection={<IconPlus size={16} />} size="sm" onClick={() => openModal()}>
                Add Profile
              </Button>
            </Group>

            <Stack gap="sm">
              {profiles.map((profile) => (
                <Paper
                  key={profile.id}
                  p="sm"
                  withBorder
                  style={{
                    backgroundColor: '#252525',
                    borderColor: '#444',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <Group
                    justify="space-between"
                    style={{ cursor: 'pointer' }}
                    onClick={() => toggleProfile(profile.id)}
                  >
                    <Group gap="xs">
                      <ActionIcon variant="subtle" size="sm">
                        {expandedProfiles.includes(profile.id) ? (
                          <IconChevronDown size={16} />
                        ) : (
                          <IconChevronRight size={16} />
                        )}
                      </ActionIcon>
                      <Text fw={500} c="white">
                        {profile.name}
                      </Text>
                      {profile.isActive && (
                        <Badge color="green" size="sm" leftSection={<IconCircleCheck size={12} />}>
                          Active
                        </Badge>
                      )}
                    </Group>
                  </Group>

                  <Collapse in={expandedProfiles.includes(profile.id)}>
                    <Box mt="md" pl="xl">
                      <Stack gap="xs">
                        <Group gap="xs">
                          <IconServer size={16} color="#666" />
                          <Text size="sm" c="dimmed">
                            Broker:
                          </Text>
                          <Text size="sm">{profile.broker}</Text>
                        </Group>
                        <Group gap="xs">
                          <IconKey size={16} color="#666" />
                          <Text size="sm" c="dimmed">
                            API Key:
                          </Text>
                          <Text size="sm">{maskApiKey(profile.apiKey)}</Text>
                        </Group>
                        <Group gap="xs">
                          <IconUser size={16} color="#666" />
                          <Text size="sm" c="dimmed">
                            Account:
                          </Text>
                          <Text size="sm">{profile.account}</Text>
                        </Group>

                        <Group gap="xs" mt="sm">
                          {!profile.isActive && (
                            <Button
                              size="xs"
                              variant="filled"
                              color="green"
                              onClick={(e) => {
                                e.stopPropagation();
                                activateProfile(profile.id);
                              }}
                            >
                              Activate
                            </Button>
                          )}
                          <Button
                            size="xs"
                            variant="light"
                            leftSection={<IconEdit size={14} />}
                            onClick={(e) => {
                              e.stopPropagation();
                              openModal(profile);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="xs"
                            variant="light"
                            color="red"
                            leftSection={<IconTrash size={14} />}
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteProfile(profile.id);
                            }}
                            disabled={profile.isActive}
                          >
                            Delete
                          </Button>
                        </Group>
                      </Stack>
                    </Box>
                  </Collapse>
                </Paper>
              ))}

              {profiles.length === 0 && (
                <Text c="dimmed" ta="center" py="xl">
                  No broker profiles configured. Click "Add Profile" to get started.
                </Text>
              )}
            </Stack>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="display" pt="xl">
          <Paper p="md" withBorder style={{ backgroundColor: '#1a1a1a', borderColor: '#333' }}>
            <Title order={4} mb="md" c="white">
              Display Settings
            </Title>
            <Text c="dimmed">Display settings will be added here...</Text>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="data" pt="xl">
          <Paper p="md" withBorder style={{ backgroundColor: '#1a1a1a', borderColor: '#333' }}>
            <Title order={4} mb="md" c="white">
              Data Settings
            </Title>
            <Text c="dimmed">Data settings will be added here...</Text>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="advanced" pt="xl">
          <Paper p="md" withBorder style={{ backgroundColor: '#1a1a1a', borderColor: '#333' }}>
            <Title order={4} mb="md" c="white">
              Advanced Settings
            </Title>
            <Text c="dimmed">Advanced settings will be added here...</Text>
          </Paper>
        </Tabs.Panel>
      </Tabs>

      {/* Add/Edit Profile Modal */}
      <Modal
        opened={modalOpen}
        onClose={closeModal}
        title={editingProfile ? 'Edit Broker Profile' : 'Add Broker Profile'}
      >
        <Stack gap="md">
          <TextInput
            label="Profile Name"
            placeholder="e.g. OANDA Practice"
            value={formData.name}
            onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
            required
          />

          <Select
            label="Broker"
            placeholder="Select broker"
            value={formData.broker}
            onChange={(value) => setFormData((prev) => ({ ...prev, broker: value || '' }))}
            data={[
              { value: 'OANDA', label: 'OANDA' },
              { value: 'Interactive Brokers', label: 'Interactive Brokers' },
              { value: 'Alpaca', label: 'Alpaca' },
              { value: 'TD Ameritrade', label: 'TD Ameritrade' },
              { value: 'E*TRADE', label: 'E*TRADE' },
              { value: 'Robinhood', label: 'Robinhood' },
              { value: 'Binance', label: 'Binance' },
              { value: 'Coinbase', label: 'Coinbase' },
              { value: 'Kraken', label: 'Kraken' },
              { value: 'FTX', label: 'FTX' },
              { value: 'Dukascopy', label: 'Dukascopy' },
            ]}
            required
          />

          <PasswordInput
            label="API Key"
            placeholder="Enter your API key"
            value={formData.apiKey}
            onChange={(e) => setFormData((prev) => ({ ...prev, apiKey: e.target.value }))}
            required
          />

          <TextInput
            label="Account ID"
            placeholder="e.g. 101-001-1234567-001"
            value={formData.account}
            onChange={(e) => setFormData((prev) => ({ ...prev, account: e.target.value }))}
            required
          />

          <Divider />

          <Group justify="flex-end">
            <Button variant="subtle" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              onClick={saveProfile}
              disabled={!formData.name || !formData.broker || !formData.apiKey || !formData.account}
            >
              {editingProfile ? 'Save Changes' : 'Add Profile'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
};

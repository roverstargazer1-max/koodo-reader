export interface NetworkInterfaceItem {
  name: string;
  address: string;
  priority: number;
  isVirtual: boolean;
}

export interface MobileServerStatus {
  running: boolean;
  port: number;
  host: string;
  token: string;
  selectedAddress: string;
  primaryAddress: string;
  interfaces: NetworkInterfaceItem[];
  connectionUrl: string;
}

export interface MobilePairingDialogProps {
  onClose: () => void;
}

export interface MobilePairingDialogState {
  running: boolean;
  port: number;
  token: string;
  selectedAddress: string;
  interfaces: NetworkInterfaceItem[];
  connectionUrl: string;
  isLoading: boolean;
  copied: boolean;
  copiedToken: boolean;
}

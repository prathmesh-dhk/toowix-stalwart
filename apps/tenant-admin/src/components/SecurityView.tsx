import React from 'react';
import { UserContext } from '../types';
import { SecuritySettingsView } from './SecuritySettingsView';

interface SecurityViewProps {
  user: UserContext;
  on2FaStatusChange?: (enabled: boolean) => void;
}

export const SecurityView: React.FC<SecurityViewProps> = ({
  user,
  on2FaStatusChange,
}) => {
  return (
    <div className="flex flex-col gap-6">
      <SecuritySettingsView user={user} on2FaStatusChange={on2FaStatusChange} />
    </div>
  );
};


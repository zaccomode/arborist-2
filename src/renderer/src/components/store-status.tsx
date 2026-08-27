import { useEffect } from 'react'
import { toast } from 'sonner'
import { invoke } from '@/api/client'
import { showErrorToast } from '@/lib/error-toast'

/**
 * Surfaces how persistence came up. v1 printed these to a console nobody was
 * reading, so a user whose data file had been replaced, or whose notes were
 * no longer being saved, found out by losing work.
 */
export function StoreStatusToasts(): null {
  useEffect(() => {
    void invoke('store:status').then((status) => {
      if (status.corruptWarning) {
        // Fixed ids, so StrictMode's second effect pass replaces the toast
        // rather than stacking a duplicate on top of it.
        showErrorToast('Your Arborist data could not be read', {
          id: 'store-corrupt',
          description: status.corruptWarning,
          duration: Infinity
        })
      }
      if (status.readOnlyReason) {
        toast.warning('Changes will not be saved', {
          id: 'store-read-only',
          description: status.readOnlyReason,
          duration: Infinity
        })
      }
    })
  }, [])

  return null
}

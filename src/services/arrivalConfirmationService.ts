import { DISPATCH_STATUS } from '../utils/dispatchStatus';

/**
 * Service managing arrival confirmation state across all driver screens.
 *
 * INVARIANT:
 * A dispatch that is In Transit (1) must NEVER automatically transition
 * to Arrived (0) or move to the "Completed Dispatches" list until the driver
 * has EXPLICITLY tapped "Arrived" / "Confirm" and completeJourney() succeeded.
 *
 * Premature Redis / server hints (which report statusDispatch 0 as soon as the
 * vehicle enters the 100m geofence) are treated as trigger signals to show
 * the confirmation popup, NEVER as an automatic status change.
 */

class ArrivalConfirmationService {
  /** Set of dispatch IDs confirmed arrived by the driver in this session. */
  private confirmedDispatchIds = new Set<string>();

  /** Set of dispatch IDs that have been active / in-transit in this session. */
  private inTransitDispatchIds = new Set<string>();

  private listeners = new Set<() => void>();

  private cleanId(id: string | number | undefined | null): string {
    if (id === undefined || id === null) return '';
    return String(id).trim();
  }

  /** Marks a dispatch as actively in-transit. */
  markInTransit(dispatchId: string | number | undefined | null): void {
    const key = this.cleanId(dispatchId);
    if (!key) return;
    if (!this.inTransitDispatchIds.has(key)) {
      this.inTransitDispatchIds.add(key);
      this.notify();
    }
  }

  /**
   * Marks a dispatch as confirmed arrived by the driver.
   * Call this ONLY after completeJourney() succeeds.
   */
  confirmArrival(dispatchId: string | number | undefined | null): void {
    const key = this.cleanId(dispatchId);
    if (!key) return;
    this.confirmedDispatchIds.add(key);
    this.inTransitDispatchIds.delete(key);
    this.notify();
  }

  /** Returns true if the driver has confirmed arrival for this dispatch. */
  isArrivalConfirmed(dispatchId: string | number | undefined | null): boolean {
    const key = this.cleanId(dispatchId);
    if (!key) return false;
    return this.confirmedDispatchIds.has(key);
  }

  /** Returns true if this dispatch is actively running / in-transit. */
  isKnownInTransit(dispatchId: string | number | undefined | null): boolean {
    const key = this.cleanId(dispatchId);
    if (!key) return false;
    return this.inTransitDispatchIds.has(key);
  }

  /**
   * Resolves the effective status of a dispatch row.
   * If the server/Redis reports ARRIVED (0), but this dispatch was in-transit
   * and the driver has NOT confirmed arrival, it returns IN_TRANSIT (1)
   * so the mobile app does NOT prematurely complete the journey.
   */
  getEffectiveStatus(
    dispatchId: string | number | undefined | null,
    rawStatus?: number
  ): number | undefined {
    const key = this.cleanId(dispatchId);
    if (!key) return rawStatus;

    if (rawStatus === DISPATCH_STATUS.IN_TRANSIT) {
      this.markInTransit(key);
      return DISPATCH_STATUS.IN_TRANSIT;
    }

    if (rawStatus === DISPATCH_STATUS.ARRIVED) {
      // If driver confirmed, trust ARRIVED.
      if (this.confirmedDispatchIds.has(key)) {
        return DISPATCH_STATUS.ARRIVED;
      }
      // If it was in-transit and driver has NOT confirmed, force IN_TRANSIT.
      if (this.inTransitDispatchIds.has(key)) {
        return DISPATCH_STATUS.IN_TRANSIT;
      }
      // Otherwise, it was already arrived before this session started (historical trip).
      return DISPATCH_STATUS.ARRIVED;
    }

    return rawStatus;
  }

  /** Resets arrival state (e.g. for re-testing). */
  reset(dispatchId?: string | number): void {
    if (dispatchId) {
      const key = this.cleanId(dispatchId);
      this.confirmedDispatchIds.delete(key);
      this.inTransitDispatchIds.delete(key);
    } else {
      this.confirmedDispatchIds.clear();
      this.inTransitDispatchIds.clear();
    }
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => {
      try {
        l();
      } catch {
        // ignore
      }
    });
  }
}

export const arrivalConfirmationService = new ArrivalConfirmationService();

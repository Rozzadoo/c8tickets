import { useState, useEffect, useCallback } from "react";
import { supabase } from './supabase';
import { DEFAULT_VENUE, mapEvent, mapVenue } from './utils';
import { TENANT_ID as DEFAULT_TENANT_ID } from '../constants';

function getSlugFromHostname() {
  const { hostname } = window.location;
  const match = hostname.match(/^([^.]+)\.c8tickets\.com$/);
  return match ? match[1] : null;
}

const useStorage = () => {
  const [venues, setVenues] = useState([DEFAULT_VENUE]);
  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [tenantId, setTenantId] = useState(DEFAULT_TENANT_ID);
  const [tenantResolved, setTenantResolved] = useState(false);

  // Step 1: resolve tenant from hostname once on mount
  useEffect(() => {
    const resolve = async () => {
      const slug = getSlugFromHostname();
      if (slug) {
        const { data } = await supabase.from('tenants').select('id').eq('slug', slug).eq('active', true).single();
        if (data?.id) setTenantId(data.id);
      }
      setTenantResolved(true);
    };
    resolve();
  }, []);

  // Step 2: load venue + events whenever tenantId changes (after initial resolution)
  const loadData = useCallback(async (id) => {
    const { data: venueRows } = await supabase.from('tenants').select('*').eq('id', id);
    if (venueRows?.length) setVenues(venueRows.map(mapVenue));

    const { data: eventsData, error: eventsError } = await supabase
      .from('events')
      .select('*, ticket_types(*)')
      .eq('tenant_id', id)
      .is('deleted_at', null)
      .order('event_date', { ascending: true });

    if (eventsError) console.error(eventsError);
    else setEvents((eventsData || []).map(mapEvent));

    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!tenantResolved) return;
    loadData(tenantId);

    const handleVisibility = () => { if (!document.hidden) loadData(tenantId); };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [tenantId, tenantResolved, loadData]);

  const switchVenue = useCallback((id) => {
    setLoaded(false);
    setTenantId(id);
  }, []);

  const updateEvents = useCallback((d) => setEvents(d), []);
  const updateVenues = useCallback((d) => setVenues(d), []);

  return { venues, events, loaded, tenantId, updateEvents, updateVenues, switchVenue };
};

export default useStorage;

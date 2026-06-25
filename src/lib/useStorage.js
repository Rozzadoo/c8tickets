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

  useEffect(() => {
    const load = async () => {
      const slug = getSlugFromHostname();
      let resolvedId = DEFAULT_TENANT_ID;

      if (slug) {
        const { data } = await supabase.from('tenants').select('id').eq('slug', slug).eq('active', true).single();
        if (data?.id) resolvedId = data.id;
      }

      setTenantId(resolvedId);

      const { data: venueRows } = await supabase.from('tenants').select('*').eq('id', resolvedId);
      if (venueRows?.length) setVenues(venueRows.map(mapVenue));

      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('*, ticket_types(*)')
        .eq('tenant_id', resolvedId)
        .is('deleted_at', null)
        .order('event_date', { ascending: true });

      if (eventsError) console.error(eventsError);
      else setEvents((eventsData || []).map(mapEvent));

      setLoaded(true);
    };
    load();

    const handleVisibility = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const updateEvents = useCallback((d) => setEvents(d), []);
  const updateVenues = useCallback((d) => setVenues(d), []);

  return { venues, events, loaded, tenantId, updateEvents, updateVenues };
};

export default useStorage;

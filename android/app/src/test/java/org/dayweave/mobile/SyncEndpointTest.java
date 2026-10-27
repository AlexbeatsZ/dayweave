package org.dayweave.mobile;

import org.junit.Test;
import static org.junit.Assert.*;

public class SyncEndpointTest {
    @Test public void supportsHttpsPathsAndLegacyLan() throws Exception {
        assertEquals("https://sync.example.com/dayweave", SyncEndpoint.parse("https://sync.example.com/dayweave/"));
        assertEquals("https://sync.example.com:63573", SyncEndpoint.parse("https://sync.example.com:63573/"));
        assertEquals("http://192.168.31.32:49732", SyncEndpoint.parse("http://192.168.31.32:49732"));
    }
    @Test public void rejectsUnsafeEndpoints() {
        for (String address : new String[]{"http://8.8.8.8", "http://example.com", "http://192.168.1.1/path", "https://user:password@example.com", "https://example.com/?token=secret", "https://example.com/#fragment", "https://example.com/a/../b", "https://example.com/%2fprivate", "https://example.com:99999"}) {
            try { SyncEndpoint.parse(address); fail(address); }
            catch (Exception expected) { }
        }
    }
}
